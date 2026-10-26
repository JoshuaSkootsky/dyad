// src/mysql/catalog.ts
import { Database, Table, Column, ForeignKey } from '../schema.js';
import { mysqlTypeToDyad } from './types.js';
import type { MysqlColumnInfo } from './types.js';

export interface MysqlQueryClient {
  // Execute a SQL query and return rows
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
}

export async function parseColumn(col: MysqlColumnInfo): Promise<Column> {
  const type = mysqlTypeToDyad(col);

  const isIdentity = (col.EXTRA || '').toLowerCase().includes('auto_increment');
  const isStored = (col.EXTRA || '').toLowerCase().includes('stored generated');
  const isVirtual = (col.EXTRA || '').toLowerCase().includes('virtual generated');
  const generated = isStored ? 'stored' : isVirtual ? 'virtual' : undefined;

  // Default value
  let defaultValue: Column['default'] | undefined;
  if (generated) {
    if (col.GENERATION_EXPRESSION) {
      defaultValue = { kind: 'expression', sql: col.GENERATION_EXPRESSION };
    }
  } else if (isIdentity) {
    defaultValue = undefined;
  } else if (col.COLUMN_DEFAULT === null || col.COLUMN_DEFAULT === undefined) {
    defaultValue = undefined;
  } else {
    const def = String(col.COLUMN_DEFAULT).trim();
    const extra = (col.EXTRA || '').toLowerCase();
    if (extra.includes('default_generated')) {
      defaultValue = { kind: 'expression', sql: def };
    } else if (/^-?\d+(\.\d+)?$/.test(def)) {
      defaultValue = { kind: 'literal', value: def };
    } else if (/^(true|false|null)$/i.test(def)) {
      defaultValue = { kind: 'literal', value: def.toLowerCase() };
    } else {
      defaultValue = { kind: 'literal', value: def };
    }
  }

  const identity = isIdentity ? { generated: 'by_default' as const } : undefined;

  const collation = ['char', 'varchar', 'text'].includes(type.kind) ? (col.COLLATION_NAME ?? undefined) : undefined;
  // keep collation already set on type; also set column-level? Schema allows column-level collation. Use type.collation only.
  const nullable = col.IS_NULLABLE === 'YES';

  const primaryKey = col.COLUMN_KEY === 'PRI' ? true : undefined;

  return Column.parse({
    name: col.COLUMN_NAME,
    type,
    nullable,
    default: defaultValue,
    identity,
    generated,
    primaryKey,
    collation,
  });
}

export async function parseTable(client: MysqlQueryClient, dbName: string, tableName: string): Promise<Table> {
  const colRows = await client.query<MysqlColumnInfo>(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA,
            CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION,
            COLLATION_NAME, CHARACTER_SET_NAME, COLUMN_KEY, GENERATION_EXPRESSION, ORDINAL_POSITION
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [dbName, tableName],
  );

  const columns = await Promise.all(colRows.map(r => parseColumn(r)));

  // Primary key column order
  const pkRows = await client.query<{ COLUMN_NAME: string }>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
     ORDER BY ORDINAL_POSITION`,
    [dbName, tableName],
  );
  const primaryKey = pkRows.length ? pkRows.map(r => r.COLUMN_NAME) : undefined;

  // Foreign keys grouped by constraint name
  const fkRows = await client.query<{ CONSTRAINT_NAME: string; COLUMN_NAME: string; REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string }>(
    `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
    [dbName, tableName],
  );

  const fkMap = new Map<string, { columns: string[]; refTable: string; refColumns: string[] }>();
  for (const r of fkRows) {
    if (!fkMap.has(r.CONSTRAINT_NAME)) {
      fkMap.set(r.CONSTRAINT_NAME, { columns: [], refTable: r.REFERENCED_TABLE_NAME, refColumns: [] });
    }
    const entry = fkMap.get(r.CONSTRAINT_NAME)!;
    entry.columns.push(r.COLUMN_NAME);
    entry.refColumns.push(r.REFERENCED_COLUMN_NAME);
  }
  const foreignKeys = fkMap.size > 0 ? [...fkMap.values()] : undefined;

  // Ensure primaryKey set on columns? parseColumn already set primaryKey boolean for PRI. But for composite, each PK col marked true. Fine.

  return Table.parse({
    name: tableName,
    schema: dbName,
    columns,
    primaryKey,
    foreignKeys,
  });
}

export async function parseDatabase(client: MysqlQueryClient, dbName: string, serverVersion?: string): Promise<Database> {
  const tables = await client.query<{ TABLE_NAME: string }>(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [dbName],
  );

  const parsedTables = await Promise.all(tables.map(t => parseTable(client, dbName, t.TABLE_NAME)));

  return Database.parse({
    irVersion: '1',
    serverVersion,
    dialect: 'mysql',
    name: dbName,
    tables: parsedTables,
    // MySQL has no named types registry (enums/sets are column-level)
  });
}
