// src/sqlite/affinity.ts
import { fromNative } from '../schema.js';
import type { DyadType, Dialect } from '../schema.js';

const DIALECT: Dialect = 'sqlite';

/**
 * SQLite type affinity rules (https://www.sqlite.org/datatype3.html#type_affinity):
 * 1. Contains "INT" → INTEGER
 * 2. Contains "CHAR", "CLOB", or "TEXT" → TEXT
 * 3. Contains "BLOB" or empty → BLOB (none)
 * 4. Contains "REAL", "FLOA", or "DOUB" → REAL
 * 5. Otherwise → NUMERIC
 *
 * The declared type string is always preserved in `native` for losslessness.
 */
export type SqliteAffinity = 'integer' | 'text' | 'blob' | 'real' | 'numeric' | 'none';

export function sqliteAffinity(declaredType: string): SqliteAffinity {
  const upper = declaredType.toUpperCase().trim();
  if (upper === '') return 'blob'; // no declared type → BLOB affinity (none)
  if (upper.includes('INT')) return 'integer';
  if (upper.includes('CHAR') || upper.includes('CLOB') || upper.includes('TEXT')) return 'text';
  if (upper.includes('BLOB')) return 'blob';
  if (upper.includes('REAL') || upper.includes('FLOA') || upper.includes('DOUB')) return 'real';
  return 'numeric';
}

/**
 * Map a SQLite declared type to a DyadType.
 * Uses affinity rules but preserves the original declared type in `native`.
 * Attempts to extract parameters (length, precision) from the declared type string.
 */
export function declaredTypeToDyad(declaredType: string): DyadType {
  const upper = declaredType.toUpperCase().trim();
  const native = { dialect: DIALECT as Dialect, name: declaredType || '(none)' };

  if (upper === '') {
    return { kind: 'bytes', native: { ...native, name: '(none)' } };
  }

  const affinity = sqliteAffinity(declaredType);

  // Try to extract length/precision from declared type (e.g., "VARCHAR(255)", "DECIMAL(10,2)")
  const lenMatch = declaredType.match(/\((\d+)\)/);
  const numMatch = declaredType.match(/\((\d+)\s*,\s*(\d+)\)/);
  const length = lenMatch ? Number(lenMatch[1]) : undefined;
  const precision = numMatch ? Number(numMatch[1]) : (lenMatch ? Number(lenMatch[1]) : undefined);
  const scale = numMatch ? Number(numMatch[2]) : undefined;

  switch (affinity) {
    case 'integer':
      return { kind: 'int', bits: 64, native };
    case 'text':
      if (length) return { kind: 'varchar', length, native };
      return { kind: 'text', native };
    case 'blob':
      return { kind: 'bytes', native };
    case 'real':
      return { kind: 'double', native };
    case 'numeric':
      if (precision !== undefined && scale !== undefined) {
        return { kind: 'decimal', precision, scale, native };
      }
      if (precision !== undefined) {
        return { kind: 'decimal', precision, native };
      }
      return { kind: 'decimal', native };
    default:
      return { kind: 'custom', native };
  }
}
