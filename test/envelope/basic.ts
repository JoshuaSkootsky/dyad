import { Database } from '../../src/schema.js';
import { wrapEnvelope, unwrapEnvelope, parseEnvelope, isEnvelope, parseDatabaseEnvelope } from '../../src/envelope.js';

// Test version envelope
const db = Database.parse({
  irVersion: '1',
  dialect: 'postgres',
  name: 'testdb',
  tables: [],
});

const env = wrapEnvelope(db);
console.log('=== Version envelope test ===');
console.log('irVersion at top level:', env.irVersion);
console.log('data.dialect:', env.data.dialect);

// Serialize and re-parse
const json = JSON.stringify(env);
const parsed = parseEnvelope(JSON.parse(json));
console.log('Round-trip irVersion:', parsed.irVersion);

// Full validation via parseDatabaseEnvelope
const full = parseDatabaseEnvelope(JSON.parse(json));
console.log('Full parse dialect:', full.data.dialect);
console.log('Unwrap works:', unwrapEnvelope(full).name === 'testdb' ? 'PASS' : 'FAIL');

// Type guard
console.log('isEnvelope(env):', isEnvelope(env) ? 'PASS' : 'FAIL');
console.log('isEnvelope(db):', !isEnvelope(db) ? 'PASS' : 'FAIL');
console.log('isEnvelope(null):', !isEnvelope(null) ? 'PASS' : 'FAIL');

// Forward compat: v1 reader can read version of unknown payload
const unknownPayload = { irVersion: '2', data: { dialect: 'future', tables: [], x_future: true } };
const env2 = parseEnvelope(unknownPayload);
console.log('Forward-compat version read:', env2.irVersion === '2' ? 'PASS' : 'FAIL');
console.log('Forward-compat data accessible:', (env2.data as any).x_future === true ? 'PASS' : 'FAIL');
console.log('Full parse of v2 payload throws:', (() => { try { parseDatabaseEnvelope(unknownPayload); return 'NO (should throw)'; } catch { return 'PASS (throws as expected)'; } })());

console.log('\nVersion envelope test: PASSED');
