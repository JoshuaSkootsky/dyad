import { PGlite } from '@electric-sql/pglite';
import { parseDatabase } from '../../src/postgres/catalog.js';
import { databaseToJsonSchema } from '../../src/json-schema.js';

async function run() {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(`
    CREATE TYPE status_enum AS ENUM ('active', 'inactive');
    CREATE TABLE users (
      id serial PRIMARY KEY,
      email varchar(255) NOT NULL,
      balance numeric(10,2),
      status status_enum,
      tags text[]
    );
  `);

  const client = {
    async query<T>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
      const result = await db.query(sql, params);
      return { rows: result.rows as T[] };
    },
  };

  const ir = await parseDatabase(client as any, 'public', 'testdb');
  const schema = databaseToJsonSchema(ir);

  console.log(JSON.stringify(schema, null, 2).slice(0, 2000));
  console.log('\n--- Checks ---');
  console.log('Has $schema:', !!schema.$schema);
  console.log('Has definitions:', !!schema.definitions);
  console.log('Has status_enum def:', !!schema.definitions?.['public.status_enum']);
  console.log('users has email:', !!schema.properties?.tables?.properties?.users?.properties?.email);
  console.log('email maxLength:', schema.properties?.tables?.properties?.users?.properties?.email?.maxLength);
  console.log('balance x-dyad-precision:', schema.properties?.tables?.properties?.users?.properties?.balance?.['x-dyad-precision']);

  await db.close();
  console.log('\nJSON Schema export test: PASSED');
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
