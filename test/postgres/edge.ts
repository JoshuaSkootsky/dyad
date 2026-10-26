import { parseFormatType } from '../../src/postgres/format-type.js';

const cases: [string, string][] = [
  ['numeric(3,-2)', 'decimal'],
  ['interval hour to minute', 'interval'],
  ['interval day to second(3)', 'interval'],
  ['interval(3)', 'interval'],
  ['"char"', 'char'],
  ['bit(8)', 'bytes'],
  ['bit varying(16)', 'bytes'],
  ['character(5)', 'char'],
  ['time(3) without time zone', 'time'],
  ['integer[]', 'array'],
  ['numeric(10,2)[]', 'array'],
];
for (const [input, expected] of cases) {
  const r = parseFormatType(input);
  const ok = r.kind === expected;
  const extra = r.kind === 'decimal' ? ` prec=${r.precision} scale=${r.scale}` :
    r.kind === 'interval' ? ` fields=${r.intervalFields} prec=${r.precision}` :
    r.kind === 'char' ? ` length=${r.length}` :
    r.kind === 'array' ? ` element=${r.element?.kind}` : '';
  console.log(`${ok ? 'OK' : 'FAIL'} ${input} -> ${r.kind} (expected ${expected})${extra}`);
}
