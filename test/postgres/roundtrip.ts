import { PGlite } from '@electric-sql/pglite';
import { parseDatabase } from '../../src/postgres/catalog.js';
import { equals, normalize } from '../../src/schema.js';
import type { PgQueryClient } from '../src/postgres/catalog.js';

// ---------- DDL emitter (test helper) ----------
function emitType(type: any): string {
  switch (type.kind) {
    case 'int':
      if (type.unsigned) return 'integer'; // postgres has no unsigned
      if (type.bits === 8) return 'smallint'; // closest
      if (type.bits === 16) return 'smallint';
      if (type.bits === 64) return 'bigint';
      return 'integer';
    case 'decimal':
      if (type.precision !== undefined && type.scale !== undefined) return `numeric(${type.precision},${type.scale})`;
      if (type.precision !== undefined) return `numeric(${type.precision})`;
      return 'numeric';
    case 'float': return 'real';
    case 'double': return 'double precision';
    case 'char': return type.length ? `character(${type.length})` : 'character(1)';
    case 'varchar': return type.length ? `character varying(${type.length})` : 'text';
    case 'text': return 'text';
    case 'bytes': return 'bytea';
    case 'bool': return 'boolean';
    case 'date': return 'date';
    case 'time': return type.tz ? `time${type.precision !== undefined ? `(${type.precision})` : ''} with time zone` : `time${type.precision !== undefined ? `(${type.precision})` : ''} without time zone`;
    case 'timestamp': return type.tz ? `timestamp${type.precision !== undefined ? `(${type.precision})` : ''} with time zone` : `timestamp${type.precision !== undefined ? `(${type.precision})` : ''} without time zone`;
    case 'interval': return type.intervalFields ? `interval ${type.intervalFields}${type.precision !== undefined ? `(${type.precision})` : ''}` : 'interval';
    case 'uuid': return 'uuid';
    case 'json': return 'jsonb';
    case 'array': return `${emitType(type.element)}[]`;
    case 'enum': return type.name || 'text';
    case 'ref': return type.name || 'text';
    default: return 'text';
  }
}

function emitColumn(col: any): string {
  const parts = [col.name, emitType(col.type)];
  if (!col.nullable) parts.push('NOT NULL');
  if (col.default) {
    if (col.default.kind === 'literal') parts.push(`DEFAULT ${col.default.value}`);
    else if (col.default.kind === 'expression') parts.push(`DEFAULT ${col.default.sql}`);
  }
  if (col.identity) {
    // identity handled via serial-like; for round-trip we use the default nextval approach
  }
  return parts.join(' ');
}

function emitTable(table: any): string {
  const cols = table.columns.map(emitColumn).join(',\n  ');
  let ddl = `CREATE TABLE ${table.name} (\n  ${cols}`;
  if (table.primaryKey?.length) {
    ddl += `,\n  PRIMARY KEY (${table.primaryKey.join(', ')})`;
  }
  ddl += '\n);';
  return ddl;
}

// ---------- Test ----------
async function run() {
  const db = new PGlite();
  await db.waitReady;

  // Create test table with one column per type variant
  await db.exec(`
    CREATE TYPE status_enum AS ENUM ('active', 'inactive', 'pending');

    CREATE TABLE all_types (
      id serial PRIMARY KEY,
      int_col integer NOT NULL,
      int_small smallint,
      int_big bigint,
      decimal_col numeric(10,2) NOT NULL,
      decimal_unconstrained numeric,
      float_col real,
      double_col double precision,
      char_col character(5),
      varchar_col character varying(100),
      text_col text,
      bytes_col bytea,
      bool_col boolean,
      date_col date,
      time_col time(3) without time zone,
      timetz_col time(2) with time zone,
      ts_col timestamp(4) without time zone,
      tstz_col timestamp(6) with time zone,
      interval_col interval day to second(2),
      uuid_col uuid,
      json_col jsonb,
      int_array integer[],
      text_array text[],
      enum_col status_enum,
      nullable_col integer,
      default_col integer DEFAULT 42,
      expr_col timestamp DEFAULT now()
    );
  `);

  const client: PgQueryClient = {
    async query<T>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
      const result = await db.query(sql, params);
      return { rows: result.rows as T[] };
    },
  };

  // Parse
  const ir1 = await parseDatabase(client, 'public', 'testdb', '16.0');
  console.log('=== First parse ===');
  console.log(JSON.stringify(ir1, null, 2).slice(0, 2000));

  // Round-trip: emit DDL from IR, recreate, re-parse
  const table = ir1.tables[0];
  const ddl = emitTable(table);
  console.log('\n=== Emitted DDL ===');
  console.log(ddl);

  // Drop and recreate
  await db.exec('DROP TABLE all_types CASCADE;');
  await db.exec('DROP TYPE IF EXISTS status_enum;');
  await db.exec(ddl);
  // Recreate enum type first (DDL emitter doesn't handle enums yet)
  // Actually the enum_col was emitted as 'text' - that's a known limitation

  const ir2 = await parseDatabase(client, 'public', 'testdb', '16.0');

  console.log('\n=== Equals check ===');
  console.log('ir1 === ir2 (equals):', equals(ir1.tables[0] as any, ir2.tables[0] as any));
  console.log('normalized equal:', JSON.stringify(normalize(ir1.tables[0] as any)) === JSON.stringify(normalize(ir2.tables[0] as any)));

  // Write normalized snapshot for review
  const fs = await import('node:fs');
  const snap = JSON.stringify(ir1.tables[0].columns.map((c: any) => ({ name: c.name, type: normalize(c.type), nullable: c.nullable, default: c.default, identity: c.identity, generated: c.generated, collation: c.collation })), null, 2);
  fs.writeFileSync('test/postgres/snapshot.json', snap);
  console.log('Snapshot written to test/postgres/snapshot.json');

  await db.close();
}

run().catch(console.error);
