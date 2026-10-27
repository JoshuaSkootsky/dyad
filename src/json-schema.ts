// src/json-schema.ts
import type { DyadType, Column, Table, Database, NamedType } from './schema.js';

export interface JsonSchema {
  $schema?: string;
  $ref?: string;
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  default?: unknown;
  format?: string;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  'x-dyad-kind'?: string;
  'x-dyad-native'?: unknown;
  'x-dyad-precision'?: number;
  'x-dyad-scale'?: number;
  'x-dyad-bits'?: number;
  'x-dyad-unsigned'?: boolean;
  'x-dyad-collation'?: string;
  'x-dyad-charset'?: string;
  'x-dyad-dialect'?: string;
  'x-dyad-ir-version'?: string;
  'x-dyad-server-version'?: string;
  'x-dyad-unique'?: boolean;
  'x-dyad-primary-key'?: unknown;
  'x-dyad-foreign-keys'?: unknown;
  'x-dyad-default-expression'?: string;
  'x-dyad-identity'?: string;
  'x-dyad-generated'?: string;
  'x-dyad-bounds'?: string;
  'x-dyad-interval-fields'?: string;
  'x-dyad-tz'?: boolean;
  additionalProperties?: boolean;
  contentEncoding?: string;
  definitions?: Record<string, JsonSchema>;
  $defs?: Record<string, JsonSchema>;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  nullable?: boolean;
}

/**
 * Convert a DyadType to a JSON Schema fragment.
 * This is a LOSSY projection — see docs for approximations.
 */
export function typeToJsonSchema(type: DyadType, nullable = false): JsonSchema {
  const schema: JsonSchema = {};

  // Extension/custom metadata
  if (type.native) {
    schema['x-dyad-native'] = type.native;
  }
  schema['x-dyad-kind'] = type.kind;

  let base: JsonSchema;

  switch (type.kind) {
    case 'int':
      base = { type: 'integer' };
      if (type.bits) base['x-dyad-bits'] = type.bits;
      if (type.unsigned) base['x-dyad-unsigned'] = true;
      break;
    case 'decimal':
      // JSON Schema has no decimal; use number with x-dyad annotations
      base = { type: 'number' };
      if (type.precision !== undefined) base['x-dyad-precision'] = type.precision;
      if (type.scale !== undefined) base['x-dyad-scale'] = type.scale;
      break;
    case 'float':
    case 'double':
      base = { type: 'number' };
      if (type.bits) base['x-dyad-bits'] = type.bits;
      break;
    case 'char':
      base = { type: 'string' };
      if (type.length) base.maxLength = type.length;
      if (type.collation) base['x-dyad-collation'] = type.collation;
      if (type.charset) base['x-dyad-charset'] = type.charset;
      break;
    case 'varchar':
      base = { type: 'string' };
      if (type.length) base.maxLength = type.length;
      if (type.collation) base['x-dyad-collation'] = type.collation;
      if (type.charset) base['x-dyad-charset'] = type.charset;
      break;
    case 'text':
      base = { type: 'string' };
      if (type.collation) base['x-dyad-collation'] = type.collation;
      if (type.charset) base['x-dyad-charset'] = type.charset;
      break;
    case 'bytes':
      base = { type: 'string', contentEncoding: 'base64' as any };
      break;
    case 'bool':
      base = { type: 'boolean' };
      break;
    case 'date':
      base = { type: 'string', format: 'date' };
      break;
    case 'time':
      base = { type: 'string', format: 'time' };
      if (type.tz) base['x-dyad-tz'] = true;
      break;
    case 'timestamp':
      base = { type: 'string', format: 'date-time' };
      if (type.tz) base['x-dyad-tz'] = true;
      if (type.precision !== undefined) base['x-dyad-precision'] = type.precision;
      break;
    case 'interval':
      base = { type: 'string' };
      if (type.intervalFields) base['x-dyad-interval-fields'] = type.intervalFields;
      if (type.precision !== undefined) base['x-dyad-precision'] = type.precision;
      break;
    case 'uuid':
      base = { type: 'string', format: 'uuid' };
      break;
    case 'json':
      if (type.schema && typeof type.schema === 'object') {
        base = typeToJsonSchema(type.schema as DyadType);
      } else {
        base = {}; // any
      }
      break;
    case 'array':
      base = { type: 'array' };
      if (type.element) base.items = typeToJsonSchema(type.element);
      break;
    case 'struct':
      base = { type: 'object' };
      if (type.fields) {
        base.properties = {};
        base.required = [];
        for (const f of type.fields) {
          base.properties[f.name] = typeToJsonSchema(f.type, f.nullable ?? false);
          if (!f.nullable) base.required.push(f.name);
        }
        if (base.required.length === 0) delete base.required;
      }
      base.additionalProperties = false;
      break;
    case 'enum':
      base = { type: 'string' };
      if (type.values) base.enum = type.values;
      break;
    case 'range':
      base = { type: 'array', items: type.subtype ? typeToJsonSchema(type.subtype) : {} };
      if (type.bounds) base['x-dyad-bounds'] = type.bounds;
      break;
    case 'ref':
      base = { $ref: `#/definitions/${type.name}` };
      break;
    case 'custom':
      base = {};
      if (type.native) base['x-dyad-native'] = type.native;
      break;
    case 'unknown':
    default:
      base = {};
      break;
  }

  // Merge base into schema
  Object.assign(schema, base);

  // Nullability
  if (nullable) {
    if (schema.type && typeof schema.type === 'string') {
      schema.type = [schema.type, 'null'];
    } else if (!schema.$ref && !schema.anyOf && !schema.oneOf && Object.keys(schema).length > 0) {
      // wrap in anyOf for complex types
      const nonNull = { ...schema };
      delete nonNull['x-dyad-kind'];
      // keep x-dyad on the outer
      schema.anyOf = [nonNull, { type: 'null' }];
    }
  }

  return schema;
}

/**
 * Convert a Column to a JSON Schema property.
 */
export function columnToJsonSchema(col: Column): JsonSchema {
  const schema = typeToJsonSchema(col.type, col.nullable);
  if (col.comment) schema.description = col.comment;
  if (col.default) {
    if (col.default.kind === 'literal') {
      schema.default = col.default.value;
    } else {
      schema['x-dyad-default-expression'] = col.default.sql;
    }
  }
  if (col.identity) {
    schema['x-dyad-identity'] = col.identity.generated;
  }
  if (col.generated) {
    schema['x-dyad-generated'] = col.generated;
  }
  if (col.collation) {
    schema['x-dyad-collation'] = col.collation;
  }
  if (col.unique) {
    schema['x-dyad-unique'] = true;
  }
  if (col.primaryKey) {
    schema['x-dyad-primary-key'] = true;
  }
  return schema;
}

/**
 * Convert a Table to a JSON Schema object.
 */
export function tableToJsonSchema(table: Table): JsonSchema {
  const schema: JsonSchema = {
    type: 'object',
    title: table.name,
    properties: {},
    additionalProperties: false,
  };
  if (table.comment) schema.description = table.comment;
  const required: string[] = [];
  for (const col of table.columns) {
    schema.properties![col.name] = columnToJsonSchema(col);
    if (!col.nullable) required.push(col.name);
  }
  if (required.length > 0) schema.required = required;
  if (table.primaryKey) {
    schema['x-dyad-primary-key'] = table.primaryKey;
  }
  if (table.foreignKeys) {
    schema['x-dyad-foreign-keys'] = table.foreignKeys;
  }
  return schema;
}

/**
 * Convert a Database to a JSON Schema with definitions for named types.
 */
export function databaseToJsonSchema(db: Database): JsonSchema {
  const schema: JsonSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: db.name || db.dialect,
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
  if (db.tables.length > 0) {
    schema.properties!['tables'] = {
      type: 'object',
      properties: {},
      additionalProperties: false,
    };
    for (const table of db.tables) {
      schema.properties!['tables'].properties![table.name] = tableToJsonSchema(table);
    }
  }
  if (db.types && db.types.length > 0) {
    schema.definitions = {};
    for (const namedType of db.types) {
      schema.definitions[namedType.name] = typeToJsonSchema(namedType.type);
      schema.definitions[namedType.name].title = namedType.name;
    }
  }
  schema['x-dyad-dialect'] = db.dialect;
  schema['x-dyad-ir-version'] = db.irVersion;
  if (db.serverVersion) schema['x-dyad-server-version'] = db.serverVersion;
  return schema;
}

// Re-export for convenience
export { typeToJsonSchema as toJsonSchema };
