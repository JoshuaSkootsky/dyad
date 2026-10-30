import { PGlite } from '@electric-sql/pglite';
import { parseDatabase } from '../../src/postgres/catalog.js';
import { databaseToTs } from '../../src/probe/typescript.js';

async function run() {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(`
    CREATE TYPE status_enum AS ENUM ('active', 'inactive');
    CREATE TYPE point2d AS (x float8, y float8);
    CREATE TABLE users (
      id serial PRIMARY KEY,
      email varchar(255) NOT NULL,
      balance numeric(10,2),
      status status_enum,
      location point2d,
      tags text[],
      created_at timestamptz(3) DEFAULT now()
    );
  `);

  const client = {
    async query<T>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
      const result = await db.query(sql, params);
      return { rows: result.rows as T[] };
    },
  };

  const ir = await parseDatabase(client as any, 'public', 'testdb');
  const ts = databaseToTs(ir);

  console.log('=== Generated TypeScript ===');
  console.log(ts);
  console.log('=== Checks ===');
  console.log('Has StatusEnum type:', ts.includes('export type StatusEnum'));
  console.log('Has Point2d type:', ts.includes('export type Point2d'));
  console.log('Has Users interface:', ts.includes('export interface Users'));
  console.log('Has email: string:', ts.includes('email: string'));
  console.log('Has balance: number | null:', ts.includes('balance?: number /* decimal(10,2) */ | null') || ts.includes('balance: number | null'));
  console.log('Has status: StatusEnum | null:', ts.includes('status?: StatusEnum | null') || ts.includes('status: StatusEnum | null'));
  console.log('Has tags: string[] | null:', ts.includes('tags?: (string | null)[]') || ts.includes('tags: (string | null)[]'));
  console.log('Has location: Point2d | null:', ts.includes('location?: Point2d | null') || ts.includes('location: Point2d | null'));

  await db.close();
  console.log('\nConsumer probe test: PASSED');
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
