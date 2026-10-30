import { normalize, equals, Database } from '../../src/schema.js';
import type { DyadType } from '../../src/schema.js';

// Property tests for normalize() and equals()

const types: DyadType[] = [
  { kind: 'int', bits: 32, unsigned: false },
  { kind: 'int', bits: 8, unsigned: true },
  { kind: 'decimal', precision: 10, scale: 2 },
  { kind: 'decimal' }, // unconstrained
  { kind: 'float' },
  { kind: 'double' },
  { kind: 'char', length: 5 },
  { kind: 'varchar', length: 255 },
  { kind: 'text', collation: 'en_US' },
  { kind: 'bytes' },
  { kind: 'bool' },
  { kind: 'date' },
  { kind: 'time', precision: 3, tz: true },
  { kind: 'timestamp', precision: 6, tz: false },
  { kind: 'interval', intervalFields: 'day to second', precision: 2 },
  { kind: 'uuid' },
  { kind: 'json' },
  { kind: 'array', element: { kind: 'int', bits: 32 }, elementNullable: true },
  { kind: 'struct', fields: [{ name: 'x', type: { kind: 'int', bits: 32 }, nullable: false }] },
  { kind: 'enum', values: ['a', 'b', 'c'] },
  { kind: 'range', subtype: { kind: 'int', bits: 32 }, bounds: '[)' },
  { kind: 'ref', name: 'public.status' },
  { kind: 'custom', native: { dialect: 'postgres', name: 'citext', category: 'text' } },
  { kind: 'unknown' },
];

// With native metadata (should be stripped by normalize)
const typesWithNative: DyadType[] = types.map(t => ({
  ...t,
  native: { dialect: 'postgres', name: 'native_name', params: [1, 2] },
}));

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label); }
}

// 1. Reflexivity: equals(x, x) === true
for (const t of types) {
  check('reflexivity: ' + t.kind, equals(t, t) === true);
}

// 2. Symmetry: equals(a, b) === equals(b, a)
for (let i = 0; i < types.length; i++) {
  for (let j = i + 1; j < types.length; j++) {
    const ab = equals(types[i], types[j]);
    const ba = equals(types[j], types[i]);
    if (ab !== ba) {
      failed++;
      console.log('FAIL: symmetry: ' + types[i].kind + ' vs ' + types[j].kind);
    } else {
      passed++;
    }
  }
}
console.log('Symmetry: checked ' + (types.length * (types.length - 1) / 2) + ' pairs');

// 3. Idempotence: normalize(normalize(x)) === normalize(x)
for (const t of types) {
  const n1 = normalize(t);
  const n2 = normalize(n1);
  check('idempotence: ' + t.kind, JSON.stringify(n1) === JSON.stringify(n2));
}

// 4. Native stripping: normalize(typeWithNative) === normalize(typeWithoutNative)
for (let i = 0; i < types.length; i++) {
  const n1 = normalize(typesWithNative[i]);
  const n2 = normalize(types[i]);
  check('native-stripping: ' + types[i].kind, JSON.stringify(n1) === JSON.stringify(n2));
}

// 5. Transitivity: if equals(a,b) and equals(b,c) then equals(a,c)
// Test with normalized forms
const normalized = types.map(normalize);
for (let i = 0; i < normalized.length; i++) {
  for (let j = 0; j < normalized.length; j++) {
    for (let k = 0; k < normalized.length; k++) {
      if (equals(normalized[i] as any, normalized[j] as any) && equals(normalized[j] as any, normalized[k] as any)) {
        const transitive = equals(normalized[i] as any, normalized[k] as any);
        if (!transitive) {
          failed++;
          console.log('FAIL: transitivity: ' + i + ' ~ ' + j + ' ~ ' + k + ' but not ' + i + ' ~ ' + k);
        } else {
          passed++;
        }
      }
    }
  }
}
console.log('Transitivity: checked all triples');

// 6. Different kinds are never equal (types with same kind but different params are not equal)
// (this is a sanity check, not a strict assertion)

// 7. normalize doesn't mutate input
for (const t of types) {
  const before = JSON.stringify(t);
  normalize(t);
  const after = JSON.stringify(t);
  check('no-mutation: ' + t.kind, before === after);
}

console.log('\n=== Results ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) process.exit(1);
console.log('All property tests: PASS');
