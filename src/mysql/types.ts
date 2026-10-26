// src/mysql/types.ts
import type { DyadType, Dialect } from '../schema.js';

const DIALECT: Dialect = 'mysql';

export interface MysqlColumnInfo {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: string;
  COLUMN_DEFAULT: string | null;
  EXTRA: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
  NUMERIC_PRECISION: number | null;
  NUMERIC_SCALE: number | null;
  DATETIME_PRECISION: number | null;
  COLLATION_NAME: string | null;
  CHARACTER_SET_NAME: string | null;
  COLUMN_KEY: string;
  GENERATION_EXPRESSION: string | null;
  ORDINAL_POSITION: number;
}

function parseEnumValues(columnType: string): string[] {
  const m = columnType.match(/^enum\((.*)\)$/i) || columnType.match(/^set\((.*)\)$/i);
  if (!m) return [];
  const inner = m[1];
  const values: string[] = [];
  const re = /'((?:[^']|'')*)'/g;
  let match;
  while ((match = re.exec(inner)) !== null) {
    values.push(match[1].replace(/''/g, "'"));
  }
  return values;
}

export function mysqlTypeToDyad(col: MysqlColumnInfo): DyadType {
  const dt = col.DATA_TYPE.toLowerCase();
  const ct = col.COLUMN_TYPE.toLowerCase();
  const unsigned = /\bunsigned\b/.test(ct);
  const native = { dialect: DIALECT, name: col.COLUMN_TYPE };

  // integers
  if (['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint'].includes(dt)) {
    // tinyint(1) is often boolean in MySQL, but keep as int per IR (bool separate)
    const bits = dt === 'tinyint' ? 8 : dt === 'smallint' ? 16 : dt === 'mediumint' ? 24 : dt === 'bigint' ? 64 : 32;
    return { kind: 'int', bits, unsigned: unsigned || undefined, native };
  }

  if (dt === 'bit') {
    const lenMatch = ct.match(/\((\d+)\)/);
    const bits = lenMatch ? Number(lenMatch[1]) : undefined;
    return { kind: 'bytes', native: { ...native, params: bits !== undefined ? [bits] : undefined } };
  }

  if (['decimal', 'numeric', 'dec', 'fixed'].includes(dt)) {
    return {
      kind: 'decimal',
      precision: col.NUMERIC_PRECISION ?? undefined,
      scale: col.NUMERIC_SCALE ?? undefined,
      unsigned: unsigned || undefined,
      native,
    };
  }

  if (['float'].includes(dt)) {
    return { kind: 'float', unsigned: unsigned || undefined, native };
  }

  if (['double', 'real'].includes(dt)) {
    return { kind: 'double', unsigned: unsigned || undefined, native };
  }

  if (dt === 'bool' || dt === 'boolean') {
    return { kind: 'bool', native };
  }

  if (dt === 'char') {
    return { kind: 'char', length: col.CHARACTER_MAXIMUM_LENGTH ?? undefined, collation: col.COLLATION_NAME ?? undefined, charset: col.CHARACTER_SET_NAME ?? undefined, native };
  }

  if (dt === 'varchar') {
    return { kind: 'varchar', length: col.CHARACTER_MAXIMUM_LENGTH ?? undefined, collation: col.COLLATION_NAME ?? undefined, charset: col.CHARACTER_SET_NAME ?? undefined, native };
  }

  if (['tinytext', 'text', 'mediumtext', 'longtext'].includes(dt)) {
    return { kind: 'text', collation: col.COLLATION_NAME ?? undefined, charset: col.CHARACTER_SET_NAME ?? undefined, native };
  }

  if (['binary', 'varbinary'].includes(dt)) {
    return { kind: 'bytes', length: col.CHARACTER_MAXIMUM_LENGTH ?? undefined, native };
  }

  if (['tinyblob', 'blob', 'mediumblob', 'longblob'].includes(dt)) {
    return { kind: 'bytes', native };
  }

  if (dt === 'date') return { kind: 'date', native };
  if (dt === 'time') return { kind: 'time', precision: col.DATETIME_PRECISION ?? undefined, native };
  if (dt === 'datetime') return { kind: 'timestamp', precision: col.DATETIME_PRECISION ?? undefined, tz: false, native };
  if (dt === 'timestamp') return { kind: 'timestamp', precision: col.DATETIME_PRECISION ?? undefined, tz: false, native };
  if (dt === 'year') return { kind: 'custom', native: { ...native, category: 'year' } };

  if (dt === 'json') return { kind: 'json', native };

  if (dt === 'enum') {
    const values = parseEnumValues(col.COLUMN_TYPE);
    return { kind: 'enum', values, native };
  }

  if (dt === 'set') {
    const values = parseEnumValues(col.COLUMN_TYPE);
    return { kind: 'enum', values, native: { ...native, category: 'set' } };
  }

  if (dt === 'geometry' || dt === 'point' || dt === 'linestring' || dt === 'polygon' || dt === 'multipoint' || dt === 'multilinestring' || dt === 'multipolygon' || dt === 'geometrycollection') {
    return { kind: 'custom', native: { ...native, category: 'spatial' } };
  }

  // fallback
  return { kind: 'custom', native };
}
