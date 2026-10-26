import { PGlite } from '@electric-sql/pglite';
import { parseDatabase } from '../../src/postgres/catalog.js';
import { equals } from '../../src/schema.js';

function emitType(type: any): string {
  switch (type.kind) {
    case 'int':
      if (type.bits === 8 || type.bits === 16) return 'smallint';
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
    case 'ref': return type.name;
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
  return parts.join(' ');
}

async function run() {
  const db = new PGlite();
  await db.waitReady;

  // Create enum + table
  await db.exec(`
    CREATE TYPE status_enum AS ENUM ('active', 'inactive', 'pending');
    CREATE TABLE all_types (
      id serial PRIMARY KEY,
      int_col integer NOT NULL,
      decimal_col numeric(10,2),
      varchar_col character varying(100),
      ts_col timestamp(3) with time zone,
      interval_col interval day to second(2),
      json_col jsonb,
      int_array integer[],
      enum_col status_enum,
      default_col integer DEFAULT 42
    );
  `);

  const client = {
    async query<T>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
      const result = await db.query(sql, params);
      return { rows: result.rows as T[] };
    },
  };

  // First parse
  const ir1 = await parseDatabase(client as any, 'public', 'testdb', '16.0');

  // Topological sort for types
  function typeDeps(t: any): string[] {
    const deps: string[] = [];
    const ty = t.type;
    if (!ty) return deps;
    function collect(x: any) {
      if (!x) return;
      if (x.kind === 'ref' && x.name) deps.push(x.name);
      if (x.kind === 'array' && x.element) collect(x.element);
      if (x.kind === 'struct' && x.fields) x.fields.forEach((f: any) => collect(f.type));
      if (x.kind === 'range' && x.subtype) collect(x.subtype);
    }
    collect(ty);
    return deps;
  }
  function topoSort(types: any[]): any[] {
    const byName = new Map(types.map((t: any) => [t.name, t]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: any[] = [];
    function visit(name: string): boolean {
      if (visited.has(name)) return true;
      if (visiting.has(name)) return false;
      visiting.add(name);
      const t = byName.get(name);
      if (t) {
        for (const dep of typeDeps(t)) {
          if (byName.has(dep) && !visit(dep)) return false;
        }
        result.push(t);
      }
      visiting.delete(name);
      visited.add(name);
      return true;
    }
    for (const t of types) {
      if (!visited.has(t.name)) visit(t.name);
    }
    return result;
  }

  const sortedTypes = topoSort(ir1.types ?? []);
  const typeDdl = sortedTypes
    .map((t: any) => {
      if (t.kind === 'enum') return `CREATE TYPE ${t.name} AS ENUM (${(t.type.values || []).map((v: string) => `'${v}'`).join(', ')});`;
      if (t.kind === 'domain') return `CREATE DOMAIN ${t.name} AS ${t.type.name || 'text'};`;
      if (t.kind === 'range') return `CREATE TYPE ${t.name} AS RANGE (SUBTYPE = integer);`;
      return null;
    })
    .filter(Boolean)
    .join('\n');
  const tableDdl = emitTable(ir1.tables[0]);
  const fullDdl = (typeDdl ? typeDdl + '\n' : '') + tableDdl;

  console.log('=== Emitted DDL ===');
  console.log(fullDdl);
  console.log('');

  // Drop and recreate
  await db.exec('DROP TABLE all_types CASCADE;');
  await db.exec('DROP TYPE IF EXISTS status_enum CASCADE;');
  await db.exec(fullDdl);

  // Second parse
  const ir2 = await parseDatabase(client as any, 'public', 'testdb', '16.0');

  // Compare
  console.log('=== Equals check ===');
  console.log('ir1 === ir2:', equals(ir1.tables[0] as any, ir2.tables[0] as any) ? 'PASS' : 'FAIL');

  // Check enum survived round-trip
  const enumCol1 = ir1.tables[0].columns.find((c: any) => c.name === 'enum_col');
  const enumCol2 = ir2.tables[0].columns.find((c: any) => c.name === 'enum_col');
  console.log('enum_col round-tripped as ref:', enumCol2?.type.kind === 'ref' ? 'PASS' : 'FAIL (got ' + enumCol2?.type.kind + ')');

  await db.close();
  console.log('\nRound-trip test: DONE');
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

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
