import Database from 'better-sqlite3';
import { parseDatabase } from '../../src/sqlite/catalog.js';

function makeClient(db: any): any {
  return {
    all<T>(sql: string, ...params: any[]): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    pragma<T>(name: string, arg?: string): T[] {
      if (arg) return db.pragma(`${name}(${arg})`) as T[];
      return db.pragma(name) as T[];
    },
  };
}

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    age INTEGER,
    balance REAL,
    data BLOB,
    created_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'active'
  );
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount REAL NOT NULL,
    created_at TEXT
  );
`);

const client = makeClient(db);
const ir = parseDatabase(client, 'testdb');

console.log('Dialect:', ir.dialect);
console.log('Tables:', ir.tables.map((t: any) => t.name));
console.log('');

for (const t of ir.tables) {
  console.log(`Table: ${t.name} (PK: ${JSON.stringify(t.primaryKey)})`);
  for (const c of t.columns) {
    console.log(`  ${c.name}: ${c.type.kind} nullable=${c.nullable} default=${JSON.stringify(c.default)} pk=${c.primaryKey ?? false}`);
    if (c.type.native) console.log(`    native: ${c.type.native.name} (affinity: ${c.type.kind})`);
  }
  if (t.foreignKeys) {
    console.log('  FKs:', JSON.stringify(t.foreignKeys));
  }
}

// Assertions
const users = ir.tables.find((t: any) => t.name === 'users')!;
const emailCol = users.columns.find((c: any) => c.name === 'email');
const idCol = users.columns.find((c: any) => c.name === 'id');
const statusCol = users.columns.find((c: any) => c.name === 'status');

console.log('\n--- Assertions ---');
console.log('email NOT NULL:', emailCol.nullable === false ? 'PASS' : 'FAIL');
console.log('id PK:', idCol.primaryKey === true ? 'PASS' : 'FAIL');
console.log('status default literal:', statusCol.default?.kind === 'literal' && statusCol.default?.value === 'active' ? 'PASS' : 'FAIL');
console.log('native preserved (email):', emailCol.type.native?.name === 'TEXT' ? 'PASS' : 'FAIL');
const balanceCol = users.columns.find((c: any) => c.name === 'balance');
const dataCol = users.columns.find((c: any) => c.name === 'data');
const createdCol = users.columns.find((c: any) => c.name === 'created_at');
console.log('balance -> double (REAL affinity):', balanceCol.type.kind === 'double' ? 'PASS' : 'FAIL');
console.log('data -> bytes (BLOB affinity):', dataCol.type.kind === 'bytes' ? 'PASS' : 'FAIL');
console.log('created_at default expression:', createdCol.default?.kind === 'expression' ? 'PASS' : 'FAIL');
const ordersTable = ir.tables.find((t: any) => t.name === 'orders');
console.log('FK on orders:', ordersTable?.foreignKeys ? 'PASS' : 'FAIL');

db.close();
console.log('\nSQLite parser test: DONE');
