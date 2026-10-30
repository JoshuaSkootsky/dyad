// src/probe/typescript.ts
// Consumer probe: project a Dyad Database IR into TypeScript type definitions.
// This is a READ-ONLY consumer of the IR — it does not modify the IR.
// Demonstrates that dyad's contract is consumable by tools like Reylo.

import type { DyadType, Column, Table, Database, NamedType } from '../schema.js';

export interface TsProjectionOptions {
  /** Prefix for generated type names (default: '') */
  prefix?: string;
  /** Whether to generate readonly properties (default: false) */
  readonly?: boolean;
  /** Indentation (default: 2 spaces) */
  indent?: string;
}

const DEFAULT_OPTIONS: TsProjectionOptions = {
  prefix: '',
  readonly: false,
  indent: '  ',
};

/**
 * Project a DyadType to a TypeScript type string.
 */
export function typeToTs(type: DyadType, nullable: boolean, options: TsProjectionOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const ind = opts.indent ?? '  ';

  let tsType: string;

  switch (type.kind) {
    case 'int':
      tsType = 'number';
      break;
    case 'decimal':
      // Preserve precision info as comment; TS has no decimal type
      tsType = 'number /* decimal' + (type.precision !== undefined ? `(${type.precision},${type.scale ?? 0})` : '') + ' */';
      break;
    case 'float':
    case 'double':
      tsType = 'number';
      break;
    case 'char':
    case 'varchar':
    case 'text':
      tsType = 'string';
      break;
    case 'bytes':
      tsType = 'Uint8Array';
      break;
    case 'bool':
      tsType = 'boolean';
      break;
    case 'date':
      tsType = 'Date';
      break;
    case 'time':
    case 'timestamp':
      tsType = 'Date';
      break;
    case 'interval':
      tsType = 'string /* interval */';
      break;
    case 'uuid':
      tsType = 'string /* uuid */';
      break;
    case 'json':
      if (type.schema && typeof type.schema === 'object' && (type.schema as any).kind) {
        tsType = typeToTs(type.schema as DyadType, false, opts);
      } else {
        tsType = 'unknown';
      }
      break;
    case 'array':
      if (type.element) {
        const elemTs = typeToTs(type.element, type.elementNullable ?? true, opts);
        // Parenthesize if elemTs contains union to avoid precedence issues
        const wrapped = elemTs.includes(' | ') ? `(${elemTs})` : elemTs;
        tsType = `${wrapped}[]`;
      } else {
        tsType = 'unknown[]';
      }
      break;
    case 'struct':
      if (type.fields && type.fields.length > 0) {
        const fields = type.fields.map(f => {
          const ts = typeToTs(f.type, f.nullable ?? false, opts);
          const readonlyPrefix = opts.readonly ? 'readonly ' : '';
          return `${ind}${readonlyPrefix}${f.name}: ${ts};`;
        });
        tsType = `{\n${fields.join('\n')}\n}`;
      } else {
        tsType = 'Record<string, unknown>';
      }
      break;
    case 'enum':
      if (type.values && type.values.length > 0) {
        tsType = type.values.map(v => `'${v}'`).join(' | ');
      } else {
        tsType = 'string';
      }
      break;
    case 'range':
      tsType = 'unknown /* range */';
      break;
    case 'ref':
      tsType = type.name ? sanitizeTypeName(type.name) : 'unknown';
      break;
    case 'custom':
      // Extension types: preserve native name as a branded type hint
      tsType = `unknown /* ${type.native?.name ?? 'custom'} */`;
      break;
    case 'unknown':
    default:
      tsType = 'unknown';
      break;
  }

  if (nullable && !tsType.includes('| null') && !tsType.includes('unknown')) {
    tsType = `${tsType} | null`;
  }

  return tsType;
}

function sanitizeTypeName(name: string): string {
  // "public.status_enum" → "StatusEnum" or keep as-is for ref
  const parts = name.split('.');
  const last = parts[parts.length - 1];
  // Convert snake_case to PascalCase
  return last
    .split(/[_-]/)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

/**
 * Project a Column to a TypeScript property.
 */
export function columnToTs(col: Column, options: TsProjectionOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const ind = opts.indent ?? '  ';
  const readonlyPrefix = opts.readonly ? 'readonly ' : '';
  const tsType = typeToTs(col.type, col.nullable, opts);
  const optional = col.nullable ? '?' : '';
  return `${ind}${readonlyPrefix}${col.name}${optional}: ${tsType};`;
}

/**
 * Project a Table to a TypeScript interface.
 */
export function tableToTs(table: Table, options: TsProjectionOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const ind = opts.indent ?? '  ';
  const interfaceName = toPascalCase(table.name);
  const props = table.columns.map(col => columnToTs(col, opts)).join('\n');
  return `export interface ${interfaceName} {\n${props}\n}`;
}

/**
 * Project a NamedType to a TypeScript type alias.
 */
export function namedTypeToTs(namedType: NamedType, options: TsProjectionOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const name = sanitizeTypeName(namedType.name);
  const tsType = typeToTs(namedType.type, false, opts);
  if (namedType.kind === 'enum' && namedType.type.kind === 'enum') {
    return `export type ${name} = ${tsType};`;
  }
  return `export type ${name} = ${tsType};`;
}

/**
 * Project an entire Database to TypeScript source code.
 */
export function databaseToTs(db: Database, options: TsProjectionOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];

  lines.push(`// Generated from dyad IR — dialect: ${db.dialect}, irVersion: ${db.irVersion}`);
  lines.push(`// This is a CONSUMER PROJECTION — lossy by design (see dyad non-goals).`);
  lines.push('');

  // Named types first (enums, domains, composites)
  if (db.types && db.types.length > 0) {
    for (const nt of db.types) {
      lines.push(namedTypeToTs(nt, opts));
    }
    lines.push('');
  }

  // Tables as interfaces
  for (const table of db.tables) {
    lines.push(tableToTs(table, opts));
    lines.push('');
  }

  return lines.join('\n');
}

function toPascalCase(s: string): string {
  return s
    .split(/[_\s-]+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}
