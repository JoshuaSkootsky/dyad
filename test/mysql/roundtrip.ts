import mysql from 'mysql2/promise';
import { parseDatabase } from '../../src/mysql/catalog.js';
import { equals } from '../../src/schema.js';

async function makeClient(conn: any): Promise<any> {
  return {
    async query<T>(sql: string, params?: any[]): Promise<T[]> {
      const [rows] = await conn.execute(sql, params);
      return rows as T[];
    },
  };
}

function emitType(type: any): string {
  switch (type.kind) {
    case 'int':
      if (type.bits === 8) return 'TINYINT' + (type.unsigned ? ' UNSIGNED' : '');
      if (type.bits === 16) return 'SMALLINT' + (type.unsigned ? ' UNSIGNED' : '');
      if (type.bits === 64) return 'BIGINT' + (type.unsigned ? ' UNSIGNED' : '');
      return 'INT' + (type.unsigned ? ' UNSIGNED' : '');
    case 'decimal':
      if (type.precision !== undefined && type.scale !== undefined) return `DECIMAL(${type.precision},${type.scale})` + (type.unsigned ? ' UNSIGNED' : '');
      if (type.precision !== undefined) return `DECIMAL(${type.precision})` + (type.unsigned ? ' UNSIGNED' : '');
      return 'DECIMAL' + (type.unsigned ? ' UNSIGNED' : '');
    case 'float': return 'FLOAT';
    case 'double': return 'DOUBLE';
    case 'char': return type.length ? `CHAR(${type.length})` : 'CHAR(1)';
    case 'varchar': return type.length ? `VARCHAR(${type.length})` : 'VARCHAR(255)';
    case 'text': return 'TEXT';
    case 'bytes': return 'BLOB';
    case 'bool': return 'BOOLEAN';
    case 'date': return 'DATE';
    case 'time': return type.tz ? `TIME` : 'TIME';
    case 'timestamp': return 'TIMESTAMP';
    case 'uuid': return 'CHAR(36)';
    case 'json': return 'JSON';
    case 'enum': return `ENUM(${(type.values || []).map((v: string) => `'${v}'`).join(',')})`;
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
      parts.push(`DEFAULT ${col.default.sql}`);
    }
  }
  if (col.generated === 'stored') parts.push('GENERATED ALWAYS AS (CONCAT(email,\'x\')) STORED');
  // PK handled at table level, not column level
  return parts.join(' ');
}

async function run() {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3307, user: 'root', password: 'root', database: 'testdb' });

  // Drop ALL tables to avoid stale state
  await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
  const [allTables] = await conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'testdb'");
  for (const t of allTables as any[]) {
    await conn.execute('DROP TABLE IF EXISTS `' + (t.TABLE_NAME || t.table_name) + '`');
  }
  await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
  await conn.execute(`
    CREATE TABLE rt_users (
      id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(255) NOT NULL DEFAULT 'user@example.com',
      age TINYINT UNSIGNED,
      balance DECIMAL(10,2) UNSIGNED,
      data BLOB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status ENUM('active','inactive') DEFAULT 'active',
      score FLOAT,
      uid CHAR(36)
    )
  `);
  await conn.execute(`
    CREATE TABLE rt_orders (
      id INT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      amount REAL NOT NULL,
      FOREIGN KEY (user_id) REFERENCES rt_users(id)
    )
  `);

  const client = await makeClient(conn);
  const ir1 = await parseDatabase(client, 'testdb', '8.4.13');

  console.log('=== First parse ===');
  console.log('Tables:', ir1.tables.map((t: any) => t.name));
  console.log('Table names:', JSON.stringify(ir1.tables.map((t: any) => t.name)))

  // Sort tables so referenced tables are created first
  const sortedTables = [...ir1.tables].sort((a: any, b: any) => {
    const aRefsB = (a.foreignKeys || []).some((fk: any) => fk.refTable === b.name);
    const bRefsA = (b.foreignKeys || []).some((fk: any) => fk.refTable === a.name);
    if (aRefsB && !bRefsA) return 1;
    if (bRefsA && !aRefsB) return -1;
    return 0;
  });
  const ddl = sortedTables.map((t: any) => {
    const cols = t.columns.map(emitColumn).join(',\n  ');
    let d = `CREATE TABLE ${t.name} (\n  ${cols}`;
    if (t.primaryKey?.length) d += `,\n  PRIMARY KEY (${t.primaryKey.join(', ')})`;
    if (t.foreignKeys?.length) {
      for (const fk of t.foreignKeys) {
        d += `,\n  FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${fk.refTable}(${fk.refColumns.join(', ')})`;
      }
    }
    d += '\n)';
    return d;
  }).join(';\n') + ';';

  console.log('\n=== Emitted DDL ===');
  console.log(ddl);

  // Drop all tables before recreating
  await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
  const [allTables2] = await conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'testdb'");
  for (const t of allTables2 as any[]) {
    await conn.execute('DROP TABLE IF EXISTS `' + (t.TABLE_NAME || t.table_name) + '`');
  }
  await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
  for (const stmt of ddl.split(';').filter((s: string) => s.trim())) {
    await conn.execute(stmt.trim());
  }

  const ir2 = await parseDatabase(client, 'testdb', '8.4.13');

  console.log('\n=== Equals check ===');
  for (let i = 0; i < ir1.tables.length; i++) {
    const t1 = ir1.tables[i];
    const t2 = ir2.tables.find((t: any) => t.name === t1.name);
    if (t2) {
      console.log('  ' + t1.name + ': ' + (equals(t1 as any, t2 as any) ? 'PASS' : 'FAIL'));
      for (const c1 of t1.columns) {
        const c2 = t2.columns.find((c: any) => c.name === c1.name);
        if (c2) {
          console.log('    ' + c1.name + ': ' + c1.type.kind + ' -> ' + c2.type.kind + ' ' + (equals(c1.type as any, c2.type as any) ? 'PASS' : 'FAIL'));
        }
      }
    }
  }

  await conn.end();
  console.log('\nMySQL round-trip test: DONE');
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
