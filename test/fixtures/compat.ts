import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Database, equals } from '../../src/schema.js';
import { parseEnvelope, parseDatabaseEnvelope } from '../../src/envelope.js';

// Compatibility fixtures: these freeze what valid serialized IR looks like.
// If a schema change breaks any fixture, that change is a BREAKING CHANGE
// and requires an irVersion bump.

const FIXTURES_DIR = join(import.meta.dir, '..', '..', 'fixtures');

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; failures.push(label); console.log('FAIL: ' + label); }
}

function loadFixture(name: string): any {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8'));
}

console.log('=== Fixture compatibility tests ===\n');

// --- database-basic.json ---
{
  const raw = loadFixture('database-basic.json');
  const db = Database.parse(raw);
  check('basic: parses', db.dialect === 'postgres');
  check('basic: 2 tables', db.tables.length === 2);
  check('basic: users has 5 columns', db.tables[0].columns.length === 5);
  check('basic: id is int 32-bit', db.tables[0].columns[0].type.kind === 'int' && db.tables[0].columns[0].type.bits === 32);
  check('basic: id has identity', db.tables[0].columns[0].identity?.generated === 'by_default');
  check('basic: email is varchar(255)', db.tables[0].columns[1].type.kind === 'varchar' && db.tables[0].columns[1].type.length === 255);
  check('basic: balance is decimal(12,2)', db.tables[0].columns[2].type.precision === 12 && db.tables[0].columns[2].type.scale === 2);
  check('basic: balance default is literal', db.tables[0].columns[2].default?.kind === 'literal');
  check('basic: created_at is timestamptz', db.tables[0].columns[3].type.kind === 'timestamp' && db.tables[0].columns[3].type.tz === true);
  check('basic: created_at default is expression', db.tables[0].columns[3].default?.kind === 'expression');
  check('basic: tags is array<text>', db.tables[0].columns[4].type.kind === 'array' && db.tables[0].columns[4].type.element?.kind === 'text');
  check('basic: orders has FK', db.tables[1].foreignKeys?.length === 1);
  check('basic: FK references users', db.tables[1].foreignKeys?.[0].refTable === 'users');

  // Round-trip: parse → serialize → parse must be equal
  const roundTripped = Database.parse(JSON.parse(JSON.stringify(db)));
  check('basic: round-trip stable', equals(
    { kind: 'int', bits: 32 } as any,
    roundTripped.tables[0].columns[0].type as any,
  ));
  console.log('database-basic.json: OK');
}

// --- database-named-types.json ---
{
  const raw = loadFixture('database-named-types.json');
  const db = Database.parse(raw);
  check('named: parses', db.dialect === 'postgres');
  check('named: has 4 types', db.types?.length === 4);
  check('named: status_enum is enum', db.types?.[0].kind === 'enum');
  check('named: status_enum has 3 values', db.types?.[0].type.values?.length === 3);
  check('named: color_domain is domain', db.types?.[1].kind === 'domain');
  check('named: point2d is composite', db.types?.[2].kind === 'composite');
  check('named: point2d has 3 fields', db.types?.[2].type.fields?.length === 3);
  check('named: int_range is range', db.types?.[3].kind === 'range');
  check('named: status column is ref', db.tables[0].columns[0].type.kind === 'ref');
  check('named: status ref name', db.tables[0].columns[0].type.name === 'public.status_enum');
  console.log('database-named-types.json: OK');
}

// --- database-all-kinds.json ---
{
  const raw = loadFixture('database-all-kinds.json');
  const db = Database.parse(raw);
  check('all-kinds: parses', db.dialect === 'postgres');
  const cols = db.tables[0].columns;
  check('all-kinds: 27 columns', cols.length === 27);

  // Verify every kind is represented
  const kinds = new Set(cols.map(c => c.type.kind));
  const expectedKinds = ['int', 'decimal', 'float', 'double', 'char', 'varchar', 'text', 'bytes', 'bool', 'date', 'time', 'timestamp', 'interval', 'uuid', 'json', 'array', 'struct', 'enum', 'range', 'ref', 'custom', 'unknown'];
  for (const k of expectedKinds) {
    check('all-kinds: has kind ' + k, kinds.has(k as any));
  }

  // Verify specific parameterizations
  check('all-kinds: decimal(3,-2) preserved', cols[4].type.precision === 3 && cols[4].type.scale === -2);
  check('all-kinds: timetz has tz', cols[14].type.tz === true);
  check('all-kinds: timestamptz has tz', cols[16].type.tz === true);
  check('all-kinds: interval has fields', cols[17].type.intervalFields === 'day to second');
  check('all-kinds: custom has native', cols[25].type.native?.name === 'citext');
  check('all-kinds: range has subtype', cols[23].type.subtype?.kind === 'int');
  console.log('database-all-kinds.json: OK');
}

// --- database-mysql.json ---
{
  const raw = loadFixture('database-mysql.json');
  const db = Database.parse(raw);
  check('mysql: parses', db.dialect === 'mysql');
  check('mysql: id is unsigned', db.tables[0].columns[0].type.unsigned === true);
  check('mysql: email has collation', db.tables[0].columns[1].type.collation === 'utf8mb4_0900_ai_ci');
  check('mysql: email has charset', db.tables[0].columns[1].type.charset === 'utf8mb4');
  check('mysql: status is enum with values', db.tables[0].columns[2].type.kind === 'enum' && db.tables[0].columns[2].type.values?.length === 2);
  console.log('database-mysql.json: OK');
}

// --- database-sqlite.json ---
{
  const raw = loadFixture('database-sqlite.json');
  const db = Database.parse(raw);
  check('sqlite: parses', db.dialect === 'sqlite');
  check('sqlite: email is text', db.tables[0].columns[1].type.kind === 'text');
  check('sqlite: balance is double', db.tables[0].columns[2].type.kind === 'double');
  check('sqlite: data is bytes', db.tables[0].columns[3].type.kind === 'bytes');
  check('sqlite: created_at default is expression', db.tables[0].columns[4].default?.kind === 'expression');
  console.log('database-sqlite.json: OK');
}

// --- envelope.json ---
{
  const raw = loadFixture('envelope.json');
  const env = parseEnvelope(raw);
  check('envelope: irVersion readable', env.irVersion === '1');
  const full = parseDatabaseEnvelope(raw);
  check('envelope: data parses as Database', full.data.dialect === 'postgres');
  check('envelope: data has tables', full.data.tables.length === 1);
  console.log('envelope.json: OK');
}

// --- Fixture stability: serialize → parse → serialize is byte-stable ---
{
  const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json') && f.startsWith('database-'));
  for (const f of files) {
    const raw1 = JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf-8'));
    const db = Database.parse(raw1);
    const ser1 = JSON.stringify(db);
    const db2 = Database.parse(JSON.parse(ser1));
    const ser2 = JSON.stringify(db2);
    check('stability: ' + f + ' byte-stable', ser1 === ser2);
  }
  console.log('fixture stability: OK');
}

console.log('\n=== Results ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log('  - ' + f);
}
if (failed > 0) process.exit(1);
console.log('\nAll fixture compatibility tests: PASS');