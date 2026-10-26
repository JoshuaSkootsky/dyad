// src/sqlite/catalog.ts
import { Database, Table, Column, ForeignKey } from '../schema.js';
import { declaredTypeToDyad } from './affinity.js';

export interface SqliteQueryClient {
  // Execute a SQL query and return rows
  all<T = any>(sql: string, ...params: any[]): T[];
  // Execute a PRAGMA
  pragma<T = any>(name: string, arg?: string): T[];
}

interface SqliteColumnInfo {
  cid: number;
  name: string;
  type: string; // declared type (free text)
  notnull: number; // 0 or 1
  dflt_value: string | null;
  pk: number; // 0 or column index in PK
}

interface SqliteFkInfo {
  id: number;
  seq: number;
  table: string; // referenced table
  from: string; // column in this table
  to: string; // column in referenced table
}

export function parseColumn(col: SqliteColumnInfo): Column {
  // Column already imported at top
  const declaredType = col.type || '';
  const type = declaredTypeToDyad(declaredType);

  // Parse default value
  let defaultValue: Column['default'] | undefined;
  if (col.dflt_value !== null && col.dflt_value !== undefined) {
    const def = col.dflt_value.trim();
    // quoted literal
    const quotedMatch = def.match(/^'((?:[^']|'')*)'$/);
    if (quotedMatch) {
      defaultValue = { kind: 'literal', value: quotedMatch[1].replace(/''/g, "'") };
    } else if (/^-?\d+(\.\d+)?$/.test(def)) {
      defaultValue = { kind: 'literal', value: def };
    } else if (/^(true|false|null)$/i.test(def)) {
      defaultValue = { kind: 'literal', value: def.toLowerCase() };
    } else {
      defaultValue = { kind: 'expression', sql: def };
    }
  }

  // generated columns: SQLite PRAGMA doesn't distinguish stored vs virtual in older versions
  // table_info doesn't include generated info; would need pragma_table_xinfo (SQLite 3.26+)

  return Column.parse({
    name: col.name,
    type,
    nullable: col.notnull === 0,
    default: defaultValue,
    primaryKey: col.pk > 0 ? true : undefined,
  });
}

export function parseTable(client: SqliteQueryClient, tableName: string): Table {

  const cols = client.pragma<SqliteColumnInfo>('table_info', tableName);
  const columns = cols.map(parseColumn);

  // Primary key
  const pkCols = cols.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk);
  const primaryKey = pkCols.length > 0 ? pkCols.map(c => c.name) : undefined;

  // Foreign keys
  const fks = client.pragma<SqliteFkInfo>('foreign_key_list', tableName);
  const fkMap = new Map<string, { columns: string[]; refTable: string; refColumns: string[] }>();
  for (const fk of fks) {
    if (!fkMap.has(fk.table)) {
      fkMap.set(fk.table, { columns: [], refTable: fk.table, refColumns: [] });
    }
    const entry = fkMap.get(fk.table)!;
    entry.columns.push(fk.from);
    entry.refColumns.push(fk.to);
  }
  const foreignKeys = fkMap.size > 0 ? [...fkMap.values()] : undefined;

  return Table.parse({
    name: tableName,
    columns,
    primaryKey,
    foreignKeys,
  });
}

export function parseDatabase(client: SqliteQueryClient, dbName?: string): Database {

  // Get table names from sqlite_master
  const tables = client.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );

  const parsedTables = tables.map(t => parseTable(client, t.name));

  return Database.parse({
    irVersion: '1',
    dialect: 'sqlite',
    name: dbName,
    tables: parsedTables,
    // SQLite has no named types (enums, domains, composites, ranges)
  });
}
