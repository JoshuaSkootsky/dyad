import Database from 'bun:sqlite';
import { parseDatabase } from '../../src/sqlite/catalog.js';
import { equals } from '../../src/schema.js';

function makeClient(db: any): any {
  return {
    all<T>(sql: string, ...params: any[]): T[] {
      return db.query(sql).all(...params) as T[];
    },
    pragma<T>(name: string, arg?: string): T[] {
      if (arg) return db.query('PRAGMA ' + name + '(' + arg + ')').all() as T[];
      return db.query('PRAGMA ' + name).all() as T[];
    },
  };
}

function emitType(type: any): string {
  switch (type.kind) {
    case 'int': return 'INTEGER';
    case 'decimal':
      if (type.precision !== undefined && type.scale !== undefined) return `DECIMAL(${type.precision},${type.scale})`;
      if (type.precision !== undefined) return `DECIMAL(${type.precision})`;
      return 'NUMERIC';
    case 'float': return 'REAL';
    case 'double': return 'REAL';
    case 'char': return type.length ? `CHAR(${type.length})` : 'TEXT';
    case 'varchar': return type.length ? `VARCHAR(${type.length})` : 'TEXT';
    case 'text': return 'TEXT';
    case 'bytes': return 'BLOB';
    case 'bool': return 'INTEGER';
    case 'date': return 'TEXT';
    case 'time': return 'TEXT';
    case 'timestamp': return 'TEXT';
    case 'interval': return 'TEXT';
    case 'uuid': return 'TEXT';
    case 'json': return 'TEXT';
    case 'array': return 'TEXT'; // SQLite has no native arrays
    default: return 'TEXT';
  }
}

function emitColumn(col: any): string {
  const parts = [col.name, emitType(col.type)];
  if (!col.nullable) parts.push('NOT NULL');
  if (col.default) {
    if (col.default.kind === 'literal') {
      const v = col.default.value;
      if (typeof v === 'string' && !/^-?\d+(\.\d+)?$/.test(v)) {
        parts.push(`DEFAULT '${v}'`);
      } else {
        parts.push(`DEFAULT ${v}`);
      }
    } else if (col.default.kind === 'expression') {
      parts.push(`DEFAULT (${col.default.sql})`);
    }
  }
  if (col.primaryKey) parts.push('PRIMARY KEY');
  return parts.join(' ');
}

function emitTable(table: any): string {
  const cols = table.columns.map(emitColumn).join(',\n  ');
  let ddl = `CREATE TABLE ${table.name} (\n  ${cols}`;
  if (table.foreignKeys?.length) {
    for (const fk of table.foreignKeys) {
      ddl += `,\n  FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${fk.refTable}(${fk.refColumns.join(', ')})`;
    }
  }
  ddl += '\n);';
  return ddl;
}

async function run() {
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
  const ir1 = parseDatabase(client, 'testdb');

  console.log('=== First parse ===');
  console.log('Tables:', ir1.tables.map((t: any) => t.name));
  console.log('Dialect:', ir1.dialect);

  // Emit DDL
  const ddl = ir1.tables.map(emitTable).join(';\n') + ';';
  console.log('\n=== Emitted DDL ===');
  console.log(ddl);

  // Recreate
  db.exec('DROP TABLE IF EXISTS orders;');
  db.exec('DROP TABLE IF EXISTS users;');
  db.exec(ddl);

  const ir2 = parseDatabase(client, 'testdb');

  console.log('\n=== Equals check ===');
  console.log('Table count match:', ir1.tables.length === ir2.tables.length ? 'PASS' : 'FAIL');
  for (let i = 0; i < ir1.tables.length; i++) {
    const t1 = ir1.tables[i];
    const t2 = ir2.tables.find((t: any) => t.name === t1.name);
    if (t2) {
      console.log(`  ${t1.name}: ${equals(t1 as any, t2 as any) ? 'PASS' : 'FAIL'}`);
      for (const c1 of t1.columns) {
        const c2 = t2.columns.find((c: any) => c.name === c1.name);
        if (c2) {
          console.log(`    ${c1.name}: ${c1.type.kind} → ${c2.type.kind} ${equals(c1.type as any, c2.type as any) ? 'PASS' : 'FAIL'}`);
        }
      }
    } else {
      console.log(`  ${t1.name}: MISSING in ir2`);
    }
  }

  db.close();
  console.log('\nSQLite round-trip test: DONE');
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
