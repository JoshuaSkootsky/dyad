import { Database } from '../../src/schema.js';

// Forward-compat test: unknown fields must survive parse + re-serialize
const input = {
  irVersion: '1',
  dialect: 'postgres',
  name: 'testdb',
  tables: [
    {
      name: 'users',
      columns: [
        {
          name: 'id',
          type: { kind: 'int', bits: 32, unsigned: false },
          nullable: false,
          // Unknown field on Column
          x_future_column_field: 'hello',
        },
      ],
      primaryKey: ['id'],
      // Unknown field on Table
      x_future_table_field: 42,
    },
  ],
  // Unknown field on Database
  x_future_db_field: { nested: true },
};

const parsed = Database.parse(input);
const serialized = JSON.stringify(parsed);
const reparsed = Database.parse(JSON.parse(serialized));

console.log('=== Forward-compat test ===');
console.log('Column x_future_column_field preserved:', (reparsed.tables[0].columns[0] as any).x_future_column_field === 'hello' ? 'PASS' : 'FAIL');
console.log('Table x_future_table_field preserved:', (reparsed.tables[0] as any).x_future_table_field === 42 ? 'PASS' : 'FAIL');
console.log('Database x_future_db_field preserved:', (reparsed as any).x_future_db_field?.nested === true ? 'PASS' : 'FAIL');

// Unknown kinds are rejected by z.enum (documented limitation — see GOALS.md G7)
console.log('Unknown kinds rejected by z.enum: (expected — see forward-compat notes)');

// Verify no data loss in known fields
console.log('Known field (name) preserved:', reparsed.tables[0].columns[0].name === 'id' ? 'PASS' : 'FAIL');
console.log('Known field (kind) preserved:', reparsed.tables[0].columns[0].type.kind === 'int' ? 'PASS' : 'FAIL');

console.log('\nForward-compat test: DONE');
