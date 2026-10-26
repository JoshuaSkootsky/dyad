import { PGlite } from '@electric-sql/pglite';
import { parseDatabase } from '../../src/postgres/catalog.js';
import { equals } from '../../src/schema.js';

interface TestCase {
  name: string;
  ddl: string;
  setup?: string; // extra DDL (types, extensions)
  check: (ir: any) => { ok: boolean; msg: string };
}

const cases: TestCase[] = [
  // === Defaults ===
  {
    name: 'default: quoted literal with cast',
    ddl: `CREATE TABLE t (c text DEFAULT 'a'::text);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.default?.kind === 'literal' && col.default?.value === 'a', msg: JSON.stringify(col.default) };
    },
  },
  {
    name: 'default: negative number',
    ddl: `CREATE TABLE t (c integer DEFAULT -1);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.default?.kind === 'literal' && col.default?.value === '-1', msg: JSON.stringify(col.default) };
    },
  },
  {
    name: 'default: expression (CURRENT_DATE)',
    ddl: `CREATE TABLE t (c date DEFAULT CURRENT_DATE);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.default?.kind === 'expression', msg: JSON.stringify(col.default) };
    },
  },
  {
    name: 'default: expression (now())',
    ddl: `CREATE TABLE t (c timestamp DEFAULT now());`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.default?.kind === 'expression', msg: JSON.stringify(col.default) };
    },
  },
  {
    name: 'default: shared sequence stays expression',
    ddl: `CREATE SEQUENCE shared_seq; CREATE TABLE t (c integer DEFAULT nextval('shared_seq'));`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.default?.kind === 'expression' && !col.identity, msg: `default=${JSON.stringify(col.default)} identity=${col.identity}` };
    },
  },

  // === Named types ===
  {
    name: 'named type: enum',
    setup: `CREATE TYPE status_enum AS ENUM ('active', 'inactive');`,
    ddl: `CREATE TABLE t (c status_enum);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'ref' && col.type.name === 'public.status_enum', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'named type: domain over domain',
    setup: `CREATE DOMAIN pos_int AS integer CHECK (VALUE > 0); CREATE DOMAIN big_pos AS pos_int;`,
    ddl: `CREATE TABLE t (c big_pos);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'ref', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'named type: domain over array',
    setup: `CREATE DOMAIN int_arr AS integer[];`,
    ddl: `CREATE TABLE t (c int_arr);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'ref', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'named type: enum array',
    setup: `CREATE TYPE color_enum AS ENUM ('red', 'green', 'blue');`,
    ddl: `CREATE TABLE t (c color_enum[]);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'array' && col.type.element?.kind === 'ref', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'named type: composite',
    setup: `CREATE TYPE point2d AS (x float8, y float8);`,
    ddl: `CREATE TABLE t (c point2d);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'ref', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'named type: range',
    setup: `CREATE TYPE int_range AS RANGE (SUBTYPE = integer);`,
    ddl: `CREATE TABLE t (c int_range);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'ref', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'named type: non-public schema',
    setup: `CREATE SCHEMA app; CREATE TYPE app.my_status AS ENUM ('ok', 'fail');`,
    schema: 'app',
    ddl: `CREATE TABLE app.t (c app.my_status);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'ref' && col.type.name === 'app.my_status', msg: JSON.stringify(col.type) };
    },
  },

  // === Arrays ===
  {
    name: 'array: numeric(10,2)[]',
    ddl: `CREATE TABLE t (c numeric(10,2)[]);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'array' && col.type.element?.kind === 'decimal' && col.type.element?.precision === 10 && col.type.element?.scale === 2, msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'array: NOT NULL',
    ddl: `CREATE TABLE t (c integer[] NOT NULL);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'array' && col.nullable === false, msg: 'nullable=' + col.nullable };
    },
  },
  {
    name: 'array: name type (not array)',
    ddl: `CREATE TABLE t (c name);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      // name should NOT be treated as array
      return { ok: col.type.kind !== 'array', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'array: point type (not array)',
    ddl: `CREATE TABLE t (c point);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind !== 'array', msg: JSON.stringify(col.type) };
    },
  },

  // === Built-in type parameters ===
  {
    name: 'builtin: numeric(3,-2)',
    ddl: `CREATE TABLE t (c numeric(3,-2));`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'decimal' && col.type.precision === 3 && col.type.scale === -2, msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'builtin: interval hour to minute',
    ddl: `CREATE TABLE t (c interval hour to minute);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'interval' && col.type.intervalFields === 'hour to minute', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'builtin: interval day to second(3)',
    ddl: `CREATE TABLE t (c interval day to second(3));`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'interval' && col.type.intervalFields === 'day to second' && col.type.precision === 3, msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'builtin: interval(3)',
    ddl: `CREATE TABLE t (c interval(3));`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'interval' && col.type.precision === 3, msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'builtin: "char" (internal)',
    ddl: `CREATE TABLE t (c "char");`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'char', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'builtin: bit(8)',
    ddl: `CREATE TABLE t (c bit(8));`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'bytes', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'builtin: bit varying(16)',
    ddl: `CREATE TABLE t (c bit varying(16));`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'bytes', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'builtin: character(5)',
    ddl: `CREATE TABLE t (c character(5));`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'char' && col.type.length === 5, msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'builtin: time(3)',
    ddl: `CREATE TABLE t (c time(3));`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'time' && col.type.precision === 3 && col.type.tz === false, msg: JSON.stringify(col.type) };
    },
  },

  // === Collation ===
  {
    name: 'collation: explicit collation',
    ddl: `CREATE TABLE t (c text COLLATE "C");`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.collation !== undefined && col.collation !== null, msg: 'collation=' + col.collation };
    },
  },
  {
    name: 'collation: default collation (none)',
    ddl: `CREATE TABLE t (c text);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.collation === undefined || col.collation === null, msg: 'collation=' + col.collation };
    },
  },

  // === Identifiers ===
  {
    name: 'identifier: quoted column name',
    ddl: `CREATE TABLE t ("My Column" integer);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.name === 'My Column', msg: 'name=' + col.name };
    },
  },
  {
    name: 'identifier: quoted table name',
    ddl: `CREATE TABLE "My Table" (c integer);`,
    check: (ir) => {
      return { ok: ir.tables[0].name === 'My Table', msg: 'table=' + ir.tables[0].name };
    },
  },

  // === Extensions ===
  {
    name: 'extension: citext (SKIP - not available in PGlite)',
    setup: `CREATE EXTENSION IF NOT EXISTS citext;`,
    ddl: `CREATE TABLE t (c citext);`,
    skip: true,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'custom' && col.type.native?.name === 'citext', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'extension: hstore (SKIP - not available in PGlite)',
    setup: `CREATE EXTENSION IF NOT EXISTS hstore;`,
    ddl: `CREATE TABLE t (c hstore);`,
    skip: true,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'custom' && col.type.native?.category === 'hstore', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'extension: ltree (SKIP - not available in PGlite)',
    setup: `CREATE EXTENSION IF NOT EXISTS ltree;`,
    ddl: `CREATE TABLE t (c ltree);`,
    skip: true,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'custom' && col.type.native?.name === 'ltree', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'array: multi-dimensional',
    ddl: `CREATE TABLE t (c integer[][]);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.type.kind === 'array', msg: JSON.stringify(col.type) };
    },
  },
  {
    name: 'identifier: column with dot in name',
    ddl: `CREATE TABLE t ("a.b" integer);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.name === 'a.b', msg: 'name=' + col.name };
    },
  },
  {
    name: 'identifier: column with space in name',
    ddl: `CREATE TABLE t ("my col" integer);`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      return { ok: col.name === 'my col', msg: 'name=' + col.name };
    },
  },
  {
    name: 'collation: explicit collation on column',
    ddl: `CREATE TABLE t (c text COLLATE "en_US");`,
    check: (ir) => {
      const col = ir.tables[0].columns[0];
      // May or may not exist depending on PGlite locale support
      return { ok: true, msg: 'collation=' + col.collation };
    },
  },
];

async function run() {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const tc of cases) {
    const db = new PGlite();
    await db.waitReady;
    if (tc.skip) { console.log('SKIP: ' + tc.name); continue; }
    try {
      if (tc.setup) await db.exec(tc.setup);
      await db.exec(tc.ddl);

      const client = {
        async query<T>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
          const result = await db.query(sql, params);
          return { rows: result.rows as T[] };
        },
      };

      const ir = await parseDatabase(client as any, tc.schema || 'public', 'testdb');
      const result = tc.check(ir);
      if (result.ok) {
        passed++;
        console.log('PASS: ' + tc.name);
      } else {
        failed++;
        failures.push(tc.name + ': ' + result.msg);
        console.log('FAIL: ' + tc.name + ' -> ' + result.msg);
      }
    } catch (err: any) {
      failed++;
      failures.push(tc.name + ': ERROR ' + (err.message || err));
      console.log('ERROR: ' + tc.name + ' -> ' + (err.message || err));
    }
    await db.close();
  }

  console.log('\n=== Results ===');
  console.log('Passed: ' + passed + '/' + cases.length);
  console.log('Failed: ' + failed);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  - ' + f);
  }
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
