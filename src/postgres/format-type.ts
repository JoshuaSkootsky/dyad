// src/postgres/format-type.ts
import { fromNative } from '../schema.js';
import type { DyadType, Dialect } from '../schema.js';

const DIALECT: Dialect = 'postgres';

/**
 * Parse a Postgres format_type() output string into a DyadType.
 * Examples:
 *   "integer"  "character varying(255)"  "numeric(10,2)"  "numeric"
 *   "timestamp(3) with time zone"  "timestamp without time zone"
 *   "interval day to second(3)"  "boolean"  "uuid"  "jsonb"
 *   "text"  "bytea"  "character(10)"  "double precision"  "real"
 *   "integer[]"  "public.status"  "name"
 */
export function parseFormatType(formatted: string): DyadType {
  const s = formatted.trim();

  // Array: "integer[]" or "character varying(255)[]"
  if (s.endsWith('[]')) {
    const inner = parseFormatType(s.slice(0, -2));
    return { kind: 'array', element: inner, elementNullable: true };
  }

  // interval: "interval", "interval(3)", "interval day to second(3)", "interval hour to minute"
  if (s.startsWith('interval')) {
    const fieldsMatch = s.match(/^interval(?:\s+(.+?))?(?:\((\d+)\))?$/);
    const fields = fieldsMatch?.[1]?.trim() || undefined;
    const prec = fieldsMatch?.[2] ? Number(fieldsMatch[2]) : undefined;
    return { kind: 'interval', intervalFields: fields, precision: prec, native: { dialect: DIALECT, name: formatted } };
  }

  // timestamp / time with optional precision and tz
  const tsMatch = s.match(/^(timestamp|time)(?:\((\d+)\))?\s*(with time zone|without time zone)?$/);
  if (tsMatch) {
    const base = tsMatch[1];
    const prec = tsMatch[2] ? Number(tsMatch[2]) : undefined;
    const tz = tsMatch[3] === 'with time zone';
    if (base === 'timestamp') return { kind: 'timestamp', precision: prec, tz, native: { dialect: DIALECT, name: formatted } };
    return { kind: 'time', precision: prec, tz, native: { dialect: DIALECT, name: formatted } };
  }

  // character varying(n) / varchar(n)
  const vcMatch = s.match(/^(?:character varying|varchar)\s*\((\d+)\)$/);
  if (vcMatch) return { kind: 'varchar', length: Number(vcMatch[1]), native: { dialect: DIALECT, name: formatted } };

  // character(n) / char(n)
  const chMatch = s.match(/^(?:character|char)\s*\((\d+)\)$/);
  if (chMatch) return { kind: 'char', length: Number(chMatch[1]), native: { dialect: DIALECT, name: formatted } };

  // numeric(p,s) / decimal(p,s) — scale can be negative
  const numMatch = s.match(/^(?:numeric|decimal)\s*\((\d+),\s*(-?\d+)\)$/);
  if (numMatch) return { kind: 'decimal', precision: Number(numMatch[1]), scale: Number(numMatch[2]), native: { dialect: DIALECT, name: formatted } };

  // numeric(p) / decimal(p) — precision only
  const numPrecMatch = s.match(/^(?:numeric|decimal)\s*\((\d+)\)$/);
  if (numPrecMatch) return { kind: 'decimal', precision: Number(numPrecMatch[1]), native: { dialect: DIALECT, name: formatted } };

  // numeric (unconstrained)
  if (s === 'numeric' || s === 'decimal') return { kind: 'decimal', native: { dialect: DIALECT, name: formatted } };

  // "char" (internal single-char type, quoted in format_type output)
  if (s === '"char"') return { kind: 'char', length: 1, native: { dialect: DIALECT, name: formatted } };

  // bit(n) / bit varying(n)
  const bitMatch = s.match(/^bit(?: varying)?\s*\((\d+)\)$/);
  if (bitMatch) return { kind: 'bytes', native: { dialect: DIALECT, name: formatted, params: [Number(bitMatch[1])] } };
  if (s === 'bit' || s === 'bit varying') return { kind: 'bytes', native: { dialect: DIALECT, name: formatted } };

  // named type (schema-qualified, e.g. "public.status" or "my_schema.my_type")
  if (s.includes('.') && !s.includes(' ')) {
    const [schema, name] = s.split('.');
    return { kind: 'ref', name: s, native: { dialect: DIALECT, name: formatted } };
  }

  // fallback: use fromNative with the base name (strip params)
  const baseName = s.split('(')[0].trim();
  return fromNative(DIALECT, baseName, []);
}
