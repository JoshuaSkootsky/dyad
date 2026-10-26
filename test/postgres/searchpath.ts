import { PGlite } from '@electric-sql/pglite';
import { parseDatabase } from '../../src/postgres/catalog.js';

async function run() {
  const db = new PGlite();
  await db.waitReady;

  // Create a non-public schema with an enum type
  await db.exec(`
    CREATE SCHEMA app;
    CREATE TYPE app.status_enum AS ENUM ('active', 'inactive');
    CREATE TABLE app.users (
      id serial PRIMARY KEY,
      status app.status_enum NOT NULL
    );
  `);

  // Test 1: search_path includes 'app'
  await db.exec("SET search_path TO app, public;");
  const client1 = {
    async query<T>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
      const result = await db.query(sql, params);
      return { rows: result.rows as T[] };
    },
  };
  const ir1 = await parseDatabase(client1 as any, 'app', 'testdb');

  // Test 2: search_path is just 'public' (type not on path)
  await db.exec("SET search_path TO public;");
  const client2 = {
    async query<T>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
      const result = await db.query(sql, params);
      return { rows: result.rows as T[] };
    },
  };
  const ir2 = await parseDatabase(client2 as any, 'app', 'testdb');

  const col1 = ir1.tables[0].columns[1];
  const col2 = ir2.tables[0].columns[1];

  console.log('search_path=app,public → status col:', JSON.stringify(col1.type));
  console.log('search_path=public     → status col:', JSON.stringify(col2.type));

  const { equals } = await import('../../src/schema.js');
  console.log('IR identical across search_path (equals):', equals(col1.type, col2.type) ? 'PASS' : 'FAIL');
  console.log('IR identical across search_path (raw JSON):', (JSON.stringify(col1.type) === JSON.stringify(col2.type)) ? 'PASS' : 'expected-FAIL (native.name differs by search_path)');

  console.log('equals:', (await import('../../src/schema.js')).equals(col1.type, col2.type) ? 'PASS' : 'FAIL');
  await db.close();
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
