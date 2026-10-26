import { parseFormatType } from './format-type.js';
import { parseDatabase } from './catalog.js';
import type { PgQueryClient } from './catalog.js';

const cases: [string, string][] = [
  ['integer', 'int'],
  ['character varying(255)', 'varchar'],
  ['numeric(10,2)', 'decimal'],
  ['numeric', 'decimal'],
  ['timestamp(3) with time zone', 'timestamp'],
  ['timestamp without time zone', 'timestamp'],
  ['interval day to second(3)', 'interval'],
  ['boolean', 'bool'],
  ['uuid', 'uuid'],
  ['jsonb', 'json'],
  ['text', 'text'],
  ['bytea', 'bytes'],
  ['character(10)', 'char'],
  ['double precision', 'double'],
  ['real', 'float'],
  ['integer[]', 'array'],
  ['public.status', 'ref'],
];
for (const [input, expected] of cases) {
  const r = parseFormatType(input);
  const ok = r.kind === expected;
  console.log(`${ok ? 'OK' : 'FAIL'} ${input} -> ${r.kind} (expected ${expected})${r.length !== undefined ? ' length=' + r.length : ''}${r.precision !== undefined ? ' prec=' + r.precision : ''}${r.scale !== undefined ? ' scale=' + r.scale : ''}${r.tz !== undefined ? ' tz=' + r.tz : ''}${r.intervalFields ? ' fields=' + r.intervalFields : ''}`);
}

const mockClient: PgQueryClient = {
  async query<T>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
    if (sql.includes('information_schema.tables')) {
      return { rows: [{ table_name: 'users' }] as any };
    }
    if (sql.includes('information_schema.columns')) {
      return { rows: [
        { table_schema: 'public', table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: "nextval('users_id_seq'::regclass)", is_identity: 'NO', identity_generation: null, is_generated: 'NEVER', generation_expression: null, collation_name: null, ordinal_position: 1 },
        { table_schema: 'public', table_name: 'users', column_name: 'email', data_type: 'character varying(255)', is_nullable: 'NO', column_default: null, is_identity: 'NO', identity_generation: null, is_generated: 'NEVER', generation_expression: null, collation_name: null, ordinal_position: 2 },
        { table_schema: 'public', table_name: 'users', column_name: 'balance', data_type: 'numeric(12,2)', is_nullable: 'NO', column_default: null, is_identity: 'NO', identity_generation: null, is_generated: 'NEVER', generation_expression: null, collation_name: null, ordinal_position: 3 },
        { table_schema: 'public', table_name: 'users', column_name: 'created_at', data_type: 'timestamp(3) with time zone', is_nullable: 'NO', column_default: 'now()', is_identity: 'NO', identity_generation: null, is_generated: 'NEVER', generation_expression: null, collation_name: null, ordinal_position: 4 },
      ] as any };
    }
    if (sql.includes('pg_index')) {
      return { rows: [{ column_name: 'id' }] as any };
    }
    if (sql.includes('FOREIGN KEY')) {
      return { rows: [] as any };
    }
    if (sql.includes('pg_type')) {
      return { rows: [] as any };
    }
    return { rows: [] as any };
  },
};

const db = await parseDatabase(mockClient, 'public', 'testdb', '16.0');
console.log('\nParsed DB:', db.name, db.dialect, 'irVersion:', db.irVersion, 'serverVersion:', db.serverVersion);
for (const t of db.tables) {
  console.log('Table:', t.name, '(PK:', t.primaryKey, ')');
  for (const c of t.columns) {
    console.log('  ' + c.name + ': ' + c.type.kind + (c.type.length ? '(' + c.type.length + ')' : '') + (c.type.precision !== undefined ? '(' + c.type.precision + ',' + c.type.scale + ')' : '') + (c.type.tz ? ' tz' : '') + ' nullable=' + c.nullable + ' identity=' + (c.identity ? c.identity.generated : 'none') + ' default=' + JSON.stringify(c.default));
  }
}
