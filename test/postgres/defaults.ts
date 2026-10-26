import { PGlite } from '@electric-sql/pglite';
import { parseDatabase } from '../../src/postgres/catalog.js';

async function run() {
  const db = new PGlite();
  await db.waitReady;

  await db.exec(`
    CREATE TABLE defaults_test (
      id serial PRIMARY KEY,
      str_col text DEFAULT 'a'::text,
      arr_col integer[] DEFAULT '{}'::integer[],
      neg_col integer DEFAULT -1,
      neg_paren integer DEFAULT (-1),
      dec_col numeric DEFAULT -1.5,
      date_col date DEFAULT '2020-01-01'::date,
      current_date_col date DEFAULT CURRENT_DATE,
      bool_col boolean DEFAULT true,
      null_col integer DEFAULT NULL::integer,
      array_expr_col integer[] DEFAULT ARRAY[1,2],
      expr_col timestamp DEFAULT now()
    );
  `);

  const client = {
    async query<T>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
      const result = await db.query(sql, params);
      return { rows: result.rows as T[] };
    },
  };

  const ir = await parseDatabase(client as any, 'public', 'testdb');
  const cols = ir.tables[0].columns;

  const expected: Record<string, string> = {
    str_col: 'literal',
    arr_col: 'literal',
    neg_col: 'literal',
    neg_paren: 'literal',
    dec_col: 'literal',
    date_col: 'literal',
    current_date_col: 'expression',
    bool_col: 'literal',
    null_col: 'undefined',
    array_expr_col: 'expression',
    expr_col: 'expression',
  };

  console.log('--- Default classifier tests ---');
  let allPass = true;
  for (const [name, expectedKind] of Object.entries(expected)) {
    const col = cols.find(c => c.name === name)!;
    const actual = col.default?.kind ?? 'undefined';
    const ok = actual === expectedKind;
    if (!ok) allPass = false;
    console.log(`${ok ? 'OK' : 'FAIL'} ${name}: got ${actual}, expected ${expectedKind} (value: ${JSON.stringify(col.default)})`);
  }
  console.log(allPass ? '\nAll default tests: PASS' : '\nSome default tests: FAIL');

  await db.close();
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
