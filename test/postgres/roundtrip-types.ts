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
    case 'enum': return type.name || 'text';
    case 'range': return type.name || 'int4range';
    case 'struct': return type.name || 'record';
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

function topoSort(types: any[]): any[] {
  const byName = new Map(types.map((t: any) => [t.name, t]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: any[] = [];
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

function emitTypes(types: any[], tables: any[] = []): string {
  const tableNames = new Set(tables.map((t: any) => t.name));
  // Filter out multirange types (auto-created companions of range types)
  const filteredTypes = types.filter((t: any) => !t.name.endsWith('_multirange'));
  const sorted = topoSort(filteredTypes);
  const stmts: string[] = [];
  for (const t of sorted) {
    // Skip composite types that match table names (auto-created by Postgres)
    if (t.kind === 'composite' && tableNames.has(t.name.split('.').pop())) continue;
    if (t.kind === 'enum') {
      stmts.push(`CREATE TYPE ${t.name} AS ENUM (${(t.type.values || []).map((v: string) => `'${v}'`).join(', ')});`);
    } else if (t.kind === 'domain') {
      // Domain base type: use the ref name or a fallback
      const baseType = t.type.name ? t.type.name.split('.').pop() : 'integer';
      stmts.push(`CREATE DOMAIN ${t.name} AS ${baseType};`);
    } else if (t.kind === 'composite') {
      const fields = (t.type.fields || []).map((f: any) => `${f.name} ${emitType(f.type)}`).join(', ');
      stmts.push(`CREATE TYPE ${t.name} AS (${fields});`);
    } else if (t.kind === 'range') {
      stmts.push(`CREATE TYPE ${t.name} AS RANGE (SUBTYPE = integer);`);
    }
  }
  return stmts.join('\n');
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

async function run() {
  const db = new PGlite();
  await db.waitReady;

  await db.exec(`
    CREATE TYPE color_enum AS ENUM ('red', 'green', 'blue');
    CREATE DOMAIN color_domain AS color_enum;
    CREATE TYPE point2d AS (x float8, y float8, color color_domain);
    CREATE TYPE int_range AS RANGE (SUBTYPE = integer);

    CREATE TABLE complex_types (
      id serial PRIMARY KEY,
      color color_enum,
      domain_col color_domain,
      point point2d,
      range_col int_range,
      enum_arr color_enum[],
      domain_arr color_domain[]
    );
  `);

  const client = {
    async query<T>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
      const result = await db.query(sql, params);
      return { rows: result.rows as T[] };
    },
  };

  const ir1 = await parseDatabase(client as any, 'public', 'testdb', '16.0');

  console.log('=== Named types ===');
  for (const t of ir1.types ?? []) console.log(`  ${t.name} (${t.kind})`);

  // Emit DDL
  const typeDdl = emitTypes(ir1.types ?? [], ir1.tables);
  const tableDdl = emitTable(ir1.tables[0]);
  const fullDdl = (typeDdl ? typeDdl + '\n' : '') + tableDdl;

  console.log('\n=== Emitted DDL ===');
  console.log(fullDdl);

  // Drop and recreate
  await db.exec('DROP TABLE IF EXISTS complex_types CASCADE;');
  await db.exec('DROP TYPE IF EXISTS int_range CASCADE;');  // CASCADE drops int_multirange
  await db.exec('DROP TYPE IF EXISTS point2d CASCADE;');
  await db.exec('DROP DOMAIN IF EXISTS color_domain CASCADE;');
  await db.exec('DROP TYPE IF EXISTS color_enum CASCADE;');
  await db.exec(fullDdl);

  const ir2 = await parseDatabase(client as any, 'public', 'testdb', '16.0');

  console.log('\n=== Equals check ===');
  console.log('table equals:', equals(ir1.tables[0] as any, ir2.tables[0] as any) ? 'PASS' : 'FAIL');

  // Check named types survived
  for (const t1 of ir1.types ?? []) {
    const t2 = (ir2.types ?? []).find((t: any) => t.name === t1.name);
    if (t2) {
      console.log(`  ${t1.name}: ${equals(t1 as any, t2 as any) ? 'PASS' : 'FAIL'}`);
    } else {
      console.log(`  ${t1.name}: MISSING in ir2`);
    }
  }

  // Check column types
  for (const c1 of ir1.tables[0].columns) {
    const c2 = ir2.tables[0].columns.find((c: any) => c.name === c1.name);
    if (c2) {
      const ok = equals(c1.type as any, c2.type as any);
      console.log(`  col ${c1.name}: ${c1.type.kind} → ${c2.type.kind} ${ok ? 'PASS' : 'FAIL'}`);
    }
  }

  await db.close();
  console.log('\nRound-trip types test: DONE');
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
