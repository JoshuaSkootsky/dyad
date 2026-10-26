// src/postgres/catalog.ts
import type { Database, Table, Column, ForeignKey, NamedType, Dialect, Identity, DefaultValue } from '../schema.js';
import { parseFormatType } from './format-type.js';

export interface PgQueryClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}

export interface PgColumnRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  atttypid: number;
  typtype: string;
  typcategory: string;
  typlen: number;
  type_schema: string;
  type_name: string;
  typelem: number;
  elem_typtype: string | null;
  elem_type_schema: string | null;
  elem_type_name: string | null;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
  identity_generation: string | null;
  attgenerated: string; // 's' | 'v' | ''
  generation_expression: string | null;
  collation_name: string | null;
  ordinal_position: number;
  serial_seq: string | null;
}

export interface PgConstraintRow {
  constraint_type: string;
  column_name: string;
  ref_table: string | null;
  ref_column: string | null;
}

export interface PgTypeRow {
  schema_name: string;
  type_name: string;
  typtype: string;
  typcategory: string;
  typbasetype: number;
  base_type_name: string | null;
  base_schema_name: string | null;
}

const COLS_SQL = `
SELECT
  ns.nspname AS table_schema,
  cls.relname AS table_name,
  a.attname AS column_name,
  format_type(a.atttypid, a.atttypmod) AS data_type,
  a.atttypid,
  t.typtype,
  t.typcategory,
  t.typlen,
  t.typnamespace::regnamespace::text AS type_schema,
  t.typname AS type_name,
  t.typelem,
  te.typtype AS elem_typtype,
  te.typnamespace::regnamespace::text AS elem_type_schema,
  te.typname AS elem_type_name,
  CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
  pg_get_expr(ad.adbin, ad.adrelid) AS column_default,
  CASE WHEN a.attidentity != '' THEN 'YES' ELSE 'NO' END AS is_identity,
  CASE a.attidentity WHEN 'a' THEN 'ALWAYS' WHEN 'd' THEN 'BY DEFAULT' ELSE NULL END AS identity_generation,
  a.attgenerated AS attgenerated,
  CASE WHEN a.attgenerated != '' THEN pg_get_expr(ad.adbin, ad.adrelid) ELSE NULL END AS generation_expression,
  CASE WHEN a.attcollation != 0 AND a.attcollation IS DISTINCT FROM t.typcollation THEN col.collname ELSE NULL END AS collation_name,
  a.attnum AS ordinal_position,
  pg_get_serial_sequence(quote_ident(ns.nspname) || '.' || quote_ident(cls.relname), a.attname) AS serial_seq
FROM pg_attribute a
JOIN pg_class cls ON cls.oid = a.attrelid
JOIN pg_namespace ns ON ns.oid = cls.relnamespace
JOIN pg_type t ON t.oid = a.atttypid
LEFT JOIN pg_type te ON te.oid = t.typelem
LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
LEFT JOIN pg_collation col ON col.oid = a.attcollation
WHERE ns.nspname = $1
  AND cls.relname = $2
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY a.attnum;
`;

const PK_SQL = `
SELECT a.attname AS column_name
FROM pg_index i
JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
WHERE i.indrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
  AND i.indisprimary;
`;

const FK_SQL = `
SELECT
  kcu.column_name,
  ccu.table_name AS ref_table,
  ccu.column_name AS ref_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = $1
  AND tc.table_name = $2;
`;

const NAMED_TYPES_SQL = `
SELECT
  n.nspname AS schema_name,
  t.typname AS type_name,
  t.typtype,
  t.typcategory,
  t.typbasetype,
  bt.typname AS base_type_name,
  bn.nspname AS base_schema_name
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
LEFT JOIN pg_type bt ON bt.oid = t.typbasetype
LEFT JOIN pg_namespace bn ON bn.oid = bt.typnamespace
WHERE n.nspname = $1
  AND t.typtype IN ('e', 'd', 'c', 'r', 'm')
  AND t.typname NOT LIKE '\\_%';
`;

const TABLES_SQL = `
SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1
  AND c.relkind = 'r'
ORDER BY c.relname;
`;

function parseDefault(def: string | null, isIdentity: string, identityGen: string | null, isGenerated: string, genExpr: string | null, serialSeq: string | null): import('../schema.js').Column['default'] | undefined {
  if (isGenerated === 'ALWAYS' && genExpr) {
    return { kind: 'expression', sql: genExpr };
  }
  if (isIdentity === 'YES') {
    return undefined;
  }
  // serial: only if owned sequence exists
  if (serialSeq && def && /nextval\(/.test(def)) {
    return undefined;
  }
  if (!def) return undefined;
  const trimmed = def.trim();
  // quoted literal with optional cast: 'value' or 'value'::type
  const quotedMatch = trimmed.match(/^'((?:[^']|'')*)'(?:::[\w\s\[\]]+)?$/);
  if (quotedMatch) {
    return { kind: 'literal', value: quotedMatch[1].replace(/''/g, "'") };
  }
  // number (possibly negative, possibly decimal)
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: 'literal', value: trimmed };
  }
  // boolean/null (possibly with cast)
  const boolMatch = trimmed.match(/^(true|false|null)(?:::[\w\s\[\]]+)?$/i);
  if (boolMatch) {
    return { kind: 'literal', value: boolMatch[1].toLowerCase() };
  }
  // everything else is an expression
  return { kind: 'expression', sql: trimmed };
}

function parseIdentity(isIdentity: string, identityGen: string | null, serialSeq: string | null, def: string | null): Identity | undefined {
  if (isIdentity === 'YES') {
    return { generated: identityGen === 'ALWAYS' ? 'always' : 'by_default' };
  }
  // serial: only if owned sequence exists AND default uses nextval
  if (serialSeq && def && /nextval\(/.test(def)) {
    return { generated: 'by_default' };
  }
  return undefined;
}

export async function parseColumn(client: PgQueryClient, row: PgColumnRow, knownTypes?: Set<string>): Promise<Column> {
  const { Column } = await import('../schema.js');

  let type: any;
  const isArray = row.typcategory === 'A' || (row.typlen === -1 && row.typelem !== 0);

  // named type (enum/domain/composite/range) → ref (via typtype, not string matching)
  if (['e', 'd', 'c', 'r', 'm'].includes(row.typtype)) {
    type = { kind: 'ref', name: `${row.type_schema}.${row.type_name}`, native: { dialect: 'postgres', name: row.data_type } };
  }
  // array of named type
  else if (isArray && row.elem_typtype && ['e', 'd', 'c', 'r', 'm'].includes(row.elem_typtype)) {
    type = {
      kind: 'array',
      element: { kind: 'ref', name: `${row.elem_type_schema}.${row.elem_type_name}`, native: { dialect: 'postgres', name: row.elem_type_name ?? '' } },
      elementNullable: true,
      native: { dialect: 'postgres', name: row.data_type },
    };
  }
  // array of built-in → parse format_type (handles "integer[]")
  else if (isArray) {
    type = parseFormatType(row.data_type);
  }
  // built-in type → parse format_type
  else {
    type = parseFormatType(row.data_type);
  }

  const identity = parseIdentity(row.is_identity, row.identity_generation, row.serial_seq, row.column_default);
  const generated = row.attgenerated === 's' ? 'stored' : row.attgenerated === 'v' ? 'virtual' : undefined;
  const defaultValue = parseDefault(row.column_default, row.is_identity, row.identity_generation, row.attgenerated === 's' ? 'ALWAYS' : 'NEVER', row.generation_expression, row.serial_seq);

  // if serial, strip the nextval default (identity handles it)
  const finalDefault = row.serial_seq ? undefined : defaultValue;

  // collation: only for text types, and only when explicitly set (not default)
  const isTextType = ['char', 'varchar', 'text', 'bytes'].includes(type.kind);
  const collation = isTextType ? (row.collation_name ?? undefined) : undefined;

  return Column.parse({
    name: row.column_name,
    type,
    nullable: row.is_nullable === 'YES',
    default: finalDefault,
    identity,
    generated,
    collation,
  });
}

export async function parseTable(client: PgQueryClient, schemaName: string, tableName: string, knownTypes?: Set<string>): Promise<Table> {
  const { Table } = await import('../schema.js');

  const colsRes = await client.query<PgColumnRow>(COLS_SQL, [schemaName, tableName]);
  const columns = await Promise.all(colsRes.rows.map(r => parseColumn(client, r, knownTypes)));

  const pkRes = await client.query<{ column_name: string }>(PK_SQL, [schemaName, tableName]);
  const primaryKey = pkRes.rows.map(r => r.column_name);
  const pk = primaryKey.length ? primaryKey : undefined;

  const fkRes = await client.query<{ column_name: string; ref_table: string; ref_column: string }>(FK_SQL, [schemaName, tableName]);
  const fkMap = new Map<string, { columns: string[]; refTable: string; refColumns: string[] }>();
  for (const r of fkRes.rows) {
    if (!fkMap.has(r.ref_table)) fkMap.set(r.ref_table, { columns: [], refTable: r.ref_table, refColumns: [] });
    const entry = fkMap.get(r.ref_table)!;
    entry.columns.push(r.column_name);
    entry.refColumns.push(r.ref_column);
  }
  const foreignKeys = fkMap.size ? [...fkMap.values()] : undefined;

  return Table.parse({
    name: tableName,
    schema: schemaName,
    columns,
    primaryKey: pk,
    foreignKeys,
  });
}

export async function parseNamedTypes(client: PgQueryClient, schemaName: string): Promise<NamedType[]> {
  const { NamedType } = await import('../schema.js');
  const res = await client.query<PgTypeRow>(NAMED_TYPES_SQL, [schemaName]);
  const types: NamedType[] = [];
  for (const r of res.rows) {
    const qualifiedName = `${r.schema_name}.${r.type_name}`;
    let kind: 'enum' | 'domain' | 'composite' | 'range' = 'domain';
    if (r.typtype === 'e') kind = 'enum';
    else if (r.typtype === 'c') kind = 'composite';
    else if (r.typtype === 'r' || r.typtype === 'm') kind = 'range';
    else if (r.typtype === 'd') kind = 'domain';

    let type: any = { kind: 'custom', native: { dialect: 'postgres', name: qualifiedName } };
    if (kind === 'enum') {
      const labelsRes = await client.query<{ enumlabel: string }>(
        `SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = $1 AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $2)) ORDER BY enumsortorder`,
        [r.type_name, r.schema_name],
      );
      type = { kind: 'enum', values: labelsRes.rows.map(l => l.enumlabel), name: qualifiedName };
    } else if (kind === 'range') {
      type = { kind: 'range', name: qualifiedName };
    } else if (kind === 'composite') {
      type = { kind: 'struct', name: qualifiedName };
    } else if (kind === 'domain') {
      // domain references its base type
      if (r.base_type_name && r.base_schema_name) {
        type = { kind: 'ref', name: `${r.base_schema_name}.${r.base_type_name}` };
      } else {
        type = { kind: 'ref', name: qualifiedName };
      }
    }

    types.push(NamedType.parse({ name: qualifiedName, kind, type }));
  }
  return types;
}

export async function parseDatabase(client: PgQueryClient, schemaName = 'public', dbName?: string, serverVersion?: string): Promise<Database> {
  const { Database } = await import('../schema.js');

  const types = await parseNamedTypes(client, schemaName);
  const knownTypes = new Set<string>();
  for (const t of types) {
    knownTypes.add(t.name);
    const unqualified = t.name.split('.').pop();
    if (unqualified) knownTypes.add(unqualified);
  }

  const tablesRes = await client.query<{ table_name: string }>(TABLES_SQL, [schemaName]);
  const tables = await Promise.all(tablesRes.rows.map(r => parseTable(client, schemaName, r.table_name, knownTypes)));

  return Database.parse({
    irVersion: '1',
    serverVersion,
    dialect: 'postgres',
    name: dbName,
    tables,
    types: types.length ? types : undefined,
  });
}
