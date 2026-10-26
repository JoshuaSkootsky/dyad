import { PGlite } from '@electric-sql/pglite';
import { parseDatabase } from '../../src/postgres/catalog.js';

// Topological sort for named types based on dependencies
function typeDependencies(t: any): string[] {
  const deps: string[] = [];
  const type = t.type;
  if (!type) return deps;

  function collect(ty: any) {
    if (!ty) return;
    if (ty.kind === 'ref' && ty.name) deps.push(ty.name);
    if (ty.kind === 'array' && ty.element) collect(ty.element);
    if (ty.kind === 'struct' && ty.fields) ty.fields.forEach((f: any) => collect(f.type));
    if (ty.kind === 'range' && ty.subtype) collect(ty.subtype);
  }
  collect(type);
  return deps;
}

function topoSort(types: any[]): any[] {
  const byName = new Map(types.map(t => [t.name, t]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: any[] = [];
  const cycles: string[] = [];

  function visit(name: string): boolean {
    if (visited.has(name)) return true;
    if (visiting.has(name)) {
      cycles.push(name);
      return false; // cycle detected
    }
    visiting.add(name);
    const t = byName.get(name);
    if (t) {
      for (const dep of typeDependencies(t)) {
        if (byName.has(dep)) {
          if (!visit(dep)) return false;
        }
      }
      result.push(t);
    }
    visiting.delete(name);
    visited.add(name);
    return true;
  }

  for (const t of types) {
    if (!visited.has(t.name)) {
      visit(t.name);
    }
  }

  if (cycles.length) {
    console.warn('Cycles detected:', cycles);
  }
  return result;
}

async function run() {
  const db = new PGlite();
  await db.waitReady;

  // Create types with dependencies: enum -> domain -> composite -> array
  await db.exec(`
    CREATE TYPE color_enum AS ENUM ('red', 'green', 'blue');
    CREATE DOMAIN color_domain AS color_enum;
    CREATE TYPE point2d AS (x float8, y float8, color color_domain);
  `);

  // Create a table referencing these types
  await db.exec(`
    CREATE TABLE t (
      id serial PRIMARY KEY,
      color color_enum,
      pt point2d,
      colors color_enum[]
    );
  `);

  const client = {
    async query<T>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
      const result = await db.query(sql, params);
      return { rows: result.rows as T[] };
    },
  };

  const ir = await parseDatabase(client as any, 'public', 'testdb');

  console.log('=== Named types (original order) ===');
  for (const t of ir.types ?? []) console.log('  ' + t.name + ' (' + t.kind + ')');

  const sorted = topoSort(ir.types ?? []);
  console.log('\n=== Topologically sorted ===');
  for (const t of sorted) console.log('  ' + t.name + ' (' + t.kind + ')');

  // Verify dependencies come before dependents
  const order = sorted.map((t: any) => t.name);
  // color_enum should come before color_domain
  // color_domain should come before point2d
  const idxEnum = order.indexOf('public.color_enum');
  const idxDomain = order.indexOf('public.color_domain');
  const idxComposite = order.indexOf('public.point2d');

  console.log('\n=== Assertions ===');
  console.log('enum before domain:', idxEnum < idxDomain ? 'PASS' : 'FAIL');
  console.log('domain before composite:', idxDomain < idxComposite ? 'PASS' : 'FAIL');
  console.log('all types present:', order.length === (ir.types?.length ?? 0) ? 'PASS' : 'FAIL');

  await db.close();
  console.log('\nTopo sort test: DONE');
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
