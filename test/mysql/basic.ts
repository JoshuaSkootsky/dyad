import mysql from 'mysql2/promise';
import { parseDatabase } from '../../src/mysql/catalog.js';

async function makeClient(conn: any): Promise<any> {
  return {
    async query<T>(sql: string, params?: any[]): Promise<T[]> {
      const [rows] = await conn.execute(sql, params);
      return rows as T[];
    },
  };
}

async function run() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3307,
    user: 'root',
    password: 'root',
    database: 'testdb',
  });

  // Fresh table
  await conn.execute('DROP TABLE IF EXISTS users, orders');
  await conn.execute(`
    CREATE TABLE users (
      id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(255) NOT NULL DEFAULT 'user@example.com',
      age TINYINT UNSIGNED,
      balance DECIMAL(10,2) UNSIGNED,
      data BLOB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status ENUM('active','inactive') DEFAULT 'active',
      tags SET('a','b','c'),
      score FLOAT,
      uid CHAR(36),
      note TEXT COLLATE utf8mb4_bin,
      gen_col VARCHAR(100) GENERATED ALWAYS AS (CONCAT(email,'x')) STORED,
      vgen_col INT GENERATED ALWAYS AS (age+1) VIRTUAL
    )
  `);
  await conn.execute(`
    CREATE TABLE orders (
      id INT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      amount REAL NOT NULL,
      created_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  const client = await makeClient(conn);
  const ir = await parseDatabase(client, 'testdb', '8.4.13');

  console.log('Dialect:', ir.dialect);
  console.log('Tables:', ir.tables.map((t: any) => t.name));
  console.log('');

  for (const t of ir.tables) {
    console.log(`Table: ${t.name} (PK: ${JSON.stringify(t.primaryKey)})`);
    for (const c of t.columns) {
      console.log(`  ${c.name}: ${c.type.kind} unsigned=${c.type.unsigned ?? false} nullable=${c.nullable} default=${JSON.stringify(c.default)} pk=${c.primaryKey ?? false} generated=${c.generated ?? 'none'}`);
      if (c.type.native) console.log(`    native: ${c.type.native.name}`);
      if (c.type.values) console.log(`    values: ${JSON.stringify(c.type.values)}`);
      if (c.type.collation) console.log(`    collation: ${c.type.collation}`);
      if (c.type.charset) console.log(`    charset: ${c.type.charset}`);
    }
    if (t.foreignKeys) console.log('  FKs:', JSON.stringify(t.foreignKeys));
  }

  // Assertions
  const users = ir.tables.find((t: any) => t.name === 'users')!;
  const emailCol = users.columns.find((c: any) => c.name === 'email');
  const idCol = users.columns.find((c: any) => c.name === 'id');
  const statusCol = users.columns.find((c: any) => c.name === 'status');
  const tagsCol = users.columns.find((c: any) => c.name === 'tags');
  const balanceCol = users.columns.find((c: any) => c.name === 'balance');
  const dataCol = users.columns.find((c: any) => c.name === 'data');
  const createdCol = users.columns.find((c: any) => c.name === 'created_at');
  const noteCol = users.columns.find((c: any) => c.name === 'note');
  const genCol = users.columns.find((c: any) => c.name === 'gen_col');
  const vgenCol = users.columns.find((c: any) => c.name === 'vgen_col');

  let pass = true;
  function check(label: string, cond: boolean) { console.log(`${label}: ${cond ? 'PASS' : 'FAIL'}`); if (!cond) pass = false; }

  check('email NOT NULL', emailCol.nullable === false);
  check('id PK', idCol.primaryKey === true);
  check('id unsigned', idCol.type.unsigned === true);
  check('email default literal', statusCol.default?.kind === 'literal' && statusCol.default?.value === 'active' ? true : emailCol.default?.kind === 'literal' && emailCol.default?.value === 'user@example.com');
  check('status kind enum', statusCol.type.kind === 'enum');
  check('status values', JSON.stringify(statusCol.type.values) === JSON.stringify(['active','inactive']));
  check('tags kind enum (set)', tagsCol.type.kind === 'enum');
  check('tags native name set', /set/i.test(tagsCol.type.native?.name ?? '') && tagsCol.type.native?.category === 'set');
  check('balance -> decimal', balanceCol.type.kind === 'decimal');
  check('balance unsigned', balanceCol.type.unsigned === true);
  check('data -> bytes', dataCol.type.kind === 'bytes');
  check('created_at default expression', createdCol.default?.kind === 'expression');
  check('note collation', noteCol.type.collation === 'utf8mb4_bin');
  check('gen_col generated stored', genCol.generated === 'stored');
  check('gen_col default expression', genCol.default?.kind === 'expression');
  check('vgen_col generated virtual', vgenCol.generated === 'virtual');
  const ordersTable = ir.tables.find((t: any) => t.name === 'orders');
  check('FK on orders', !!ordersTable?.foreignKeys);

  await conn.end();
  console.log('\nMySQL parser test:', pass ? 'ALL PASS' : 'FAILURES PRESENT');
  if (!pass) process.exit(1);
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });