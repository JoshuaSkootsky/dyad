import { fromNative, DyadType, Database } from './schema.js';

const db = Database.parse({
  irVersion: '1',
  dialect: 'postgres',
  name: 'demo',
  tables: [
    {
      name: 'users',
      columns: [
        { name: 'id', type: { kind: 'int' }, nullable: false, primaryKey: true },
        { name: 'email', type: { kind: 'varchar', length: 255 }, nullable: false, unique: true },
        { name: 'balance', type: { kind: 'decimal', precision: 12, scale: 2 }, nullable: false },
        { name: 'meta', type: { kind: 'json', schema: { kind: 'struct', fields: [{ name: 'tags', type: { kind: 'array', element: { kind: 'text' } } }] } }, nullable: true },
        { name: 'created_at', type: { kind: 'timestamp', precision: 3, tz: true }, nullable: false },
      ],
      primaryKey: ['id'],
    },
  ],
  types: [{ name: 'status', kind: 'enum', type: { kind: 'enum', values: ['active', 'disabled'] } }],
});

console.log('tables:', db.tables.map(t => t.name));
console.log('users cols:', db.tables[0].columns.map(c => `${c.name}:${c.type.kind}`));
console.log('fromNative varchar(100):', JSON.stringify(fromNative('postgres', 'character varying', [100])));
console.log('fromNative numeric(10,2):', JSON.stringify(fromNative('postgres', 'numeric', [10, 2])));
console.log('fromNative timestamptz:', JSON.stringify(fromNative('postgres', 'timestamp with time zone', [3])));
console.log('fromNative unknown:', JSON.stringify(fromNative('sqlite', 'foo_bar')));

const t: DyadType = { kind: 'array', element: { kind: 'struct', fields: [{ name: 'x', type: { kind: 'int' } }] } };
console.log('recurse ok:', t.kind);
