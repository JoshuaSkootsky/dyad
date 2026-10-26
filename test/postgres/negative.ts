import { equals } from '../../src/schema.js';

// Negative test: ref and text must NOT be equal
const ref = { kind: 'ref', name: 'public.status_enum' } as any;
const text = { kind: 'text' } as any;
console.log('ref !== text:', equals(ref, text) === false ? 'PASS' : 'FAIL');

// Also check normalize preserves kind
console.log('normalize(ref).kind:', (equals as any)(ref, text));

// Same kind different params
const a = { kind: 'int', bits: 32, unsigned: false } as any;
const b = { kind: 'int', bits: 64, unsigned: false } as any;
console.log('int32 !== int64:', equals(a, b) === false ? 'PASS' : 'FAIL');

// Undefined vs false (the normalization fix)
const c = { kind: 'int', bits: 32 } as any;
const d = { kind: 'int', bits: 32, unsigned: false, tz: false } as any;
console.log('undefined vs false (normalized):', equals(c, d) === true ? 'PASS' : 'FAIL');

console.log('\nAll negative tests done.');
