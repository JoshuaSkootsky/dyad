import { z } from 'zod';

// ---------- Dialects ----------
export const Dialect = z.enum(['postgres', 'mysql', 'sqlite', 'sqlserver', 'oracle']);
export type Dialect = z.infer<typeof Dialect>;

// ---------- Native type escape hatch ----------
export const NativeType = z.object({
  dialect: Dialect.optional(),
  name: z.string(),
  params: z.array(z.union([z.string(), z.number()])).optional(),
  category: z.string().optional(), // e.g. "network", "geometric", "text-search"
});
export type NativeType = z.infer<typeof NativeType>;

// ---------- Default value (literal vs expression) ----------
export const DefaultValue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: z.unknown() }),
  z.object({ kind: z.literal('expression'), sql: z.string() }),
]);
export type DefaultValue = z.infer<typeof DefaultValue>;

// ---------- The superset type IR ----------
// Tagged union on `kind`. Parameters live on the type itself.
// Nullability lives on Column / struct fields / array element flags, not here.
export const DyadType: z.ZodType<DyadType> = z.lazy(() =>
  z.object({
    kind: z.enum([
      'int', 'decimal', 'float', 'double',
      'char', 'varchar', 'text', 'bytes', 'bool',
      'date', 'time', 'timestamp', 'interval',
      'uuid', 'json', 'array', 'struct', 'enum', 'range',
      'ref', 'custom', 'unknown',
    ]),
    // integer
    bits: z.union([z.literal(8), z.literal(16), z.literal(24), z.literal(32), z.literal(64)]).optional(),
    unsigned: z.boolean().optional(),
    // numeric
    precision: z.number().int().nonnegative().optional(), // undefined = unbounded (Postgres numeric)
    scale: z.number().int().optional(),
    // character
    length: z.number().int().positive().optional(),
    collation: z.string().optional(),
    charset: z.string().optional(),
    // temporal
    tz: z.boolean().optional(), // applies to time & timestamp
    intervalFields: z.string().optional(), // e.g. "year to month"
    // json
    schema: z.unknown().optional(), // nested DyadType or raw JSON Schema
    // array
    element: DyadType.optional(),
    elementNullable: z.boolean().optional(), // Postgres array element nullability
    // struct / composite
    fields: z
      .array(
        z.object({
          name: z.string(),
          type: DyadType,
          nullable: z.boolean().optional(),
        }),
      )
      .optional(),
    // enum
    values: z.array(z.string()).optional(),
    // range
    subtype: DyadType.optional(),
    bounds: z.enum(['[]', '[)', '(]', '()']).optional(),
    // ref (named type in registry)
    name: z.string().optional(),
    // custom escape hatch
    native: NativeType.optional(),
  }),
);
export type DyadType = {
  kind:
    | 'int' | 'decimal' | 'float' | 'double'
    | 'char' | 'varchar' | 'text' | 'bytes' | 'bool'
    | 'date' | 'time' | 'timestamp' | 'interval'
    | 'uuid' | 'json' | 'array' | 'struct' | 'enum' | 'range'
    | 'ref' | 'custom' | 'unknown';
  bits?: 8 | 16 | 24 | 32 | 64;
  unsigned?: boolean;
  precision?: number;
  scale?: number;
  length?: number;
  collation?: string;
  charset?: string;
  tz?: boolean;
  intervalFields?: string;
  schema?: unknown;
  element?: DyadType;
  elementNullable?: boolean;
  fields?: { name: string; type: DyadType; nullable?: boolean }[];
  values?: string[];
  subtype?: DyadType;
  bounds?: '[]' | '[)' | '(]' | '()';
  name?: string;
  native?: NativeType;
};

// ---------- Column ----------
export const Identity = z.object({
  generated: z.enum(['always', 'by_default']),
  sequence: z.string().optional(),
});
export type Identity = z.infer<typeof Identity>;

export const Column = z.object({
  name: z.string(),
  type: DyadType,
  nullable: z.boolean().default(false),
  default: DefaultValue.optional(),
  identity: Identity.optional(),
  generated: z.enum(['stored', 'virtual']).optional(), // generated column
  primaryKey: z.boolean().optional(),
  unique: z.boolean().optional(),
  collation: z.string().optional(), // column-level override
  comment: z.string().optional(),
}).superRefine((col, ctx) => {
  // identity and default are mutually exclusive
  if (col.identity && col.default) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'identity and default cannot both be set' });
  }
  // generated columns may carry their generation expression in `default` (as an
  // expression), but cannot have an identity.
  if (col.generated && col.identity) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'generated columns cannot have identity' });
  }
  // column-level collation only meaningful for text types
  if (col.collation && !['char', 'varchar', 'text'].includes(col.type.kind)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'collation only applies to char/varchar/text types' });
  }
});
export type Column = z.infer<typeof Column>;

// ---------- Table / Database ----------
export const ForeignKey = z.object({
  columns: z.array(z.string()),
  refTable: z.string(),
  refColumns: z.array(z.string()),
});
export type ForeignKey = z.infer<typeof ForeignKey>;

export const Table = z.object({
  name: z.string(),
  schema: z.string().optional(),
  columns: z.array(Column),
  primaryKey: z.array(z.string()).optional(),
  foreignKeys: z.array(ForeignKey).optional(),
  comment: z.string().optional(),
});
export type Table = z.infer<typeof Table>;

export const NamedType = z.object({
  name: z.string(),
  kind: z.enum(['enum', 'domain', 'composite', 'range']),
  type: DyadType,
});
export type NamedType = z.infer<typeof NamedType>;

export const Database = z.object({
  irVersion: z.string().default('1'),
  serverVersion: z.string().optional(),
  dialect: Dialect,
  name: z.string().optional(),
  tables: z.array(Table),
  types: z.array(NamedType).optional(),
});
export type Database = z.infer<typeof Database>;

// ---------- Helpers ----------

/** Normalize a native type name into a DyadType, preserving original in `native`. */
export function fromNative(dialect: Dialect, nativeName: string, params: (string | number)[] = []): DyadType {
  const n = nativeName.toLowerCase().trim();
  const native: NativeType = { dialect, name: nativeName, params };
  const nums = params.map(Number).filter(Number.isFinite);

  // integers (MySQL tinyint/mediumint, Postgres int2/int4/int8, SQLite affinity)
  if (/^(tinyint|smallint|int2|mediumint|int|integer|int4|bigint|int8|long)$/.test(n)) {
    const bits = /tinyint/.test(n) ? 8 : /smallint|int2/.test(n) ? 16 : /mediumint/.test(n) ? 24 : /bigint|int8/.test(n) ? 64 : 32;
    const unsigned = /unsigned/.test(n);
    return { kind: 'int', bits, unsigned: unsigned || undefined, native };
  }
  if (/^(decimal|numeric|dec|money)$/.test(n)) {
    return { kind: 'decimal', precision: nums[0], scale: nums[1], native: { ...native, category: n === 'money' ? 'money' : undefined } };
  }
  if (/^(real|float4)$/.test(n)) return { kind: 'float', native };
  if (/^(float|double precision|float8|double)$/.test(n)) return { kind: 'double', native };
  if (/^char$/.test(n) || /^character$/.test(n)) return { kind: 'char', length: nums[0], native };
  if (/^(varchar|character varying|nvarchar)$/.test(n)) return { kind: 'varchar', length: nums[0], native };
  if (/^(text|clob|longtext|mediumtext|tinytext|ntext|string)$/.test(n)) return { kind: 'text', native };
  if (/^(bytea|blob|binary|varbinary|tinyblob|mediumblob|longblob|image)$/.test(n)) return { kind: 'bytes', native };
  if (/^(bool|boolean|tinyint\(1\))$/.test(n)) return { kind: 'bool', native };
  if (/^date$/.test(n)) return { kind: 'date', native };
  if (/^time/.test(n)) return { kind: 'time', precision: nums[0], tz: n.includes('tz'), native };
  if (/^timestamp/.test(n)) return { kind: 'timestamp', precision: nums[0], tz: n.includes('tz'), native };
  if (/^interval$/.test(n)) return { kind: 'interval', intervalFields: params.join(' ') || undefined, precision: nums[0], native };
  if (/^uuid$/.test(n)) return { kind: 'uuid', native };
  if (/^jsonb?$/.test(n)) return { kind: 'json', native };
  if (n.endsWith('[]') || n.startsWith('array')) return { kind: 'array', element: { kind: 'unknown' }, native };
  if (/^enum$/.test(n)) return { kind: 'enum', native };
  if (/range$/.test(n)) return { kind: 'range', native };
  // Postgres network / geometric / text-search / misc → custom with category
  if (/^(inet|cidr|macaddr|macaddr8|xml|tsvector|tsquery|hstore|point|line|lseg|box|path|polygon|circle|bit|varbit)$/.test(n)) {
    return { kind: 'custom', native: { ...native, category: n } };
  }
  // SQLite affinity fallback: keep declared string in native
  return { kind: 'custom', native };
}

/** Canonical form: strip native metadata, normalize optional fields. */
export function normalize(type: DyadType): DyadType {
  const { native, ...rest } = type;
  const out: any = { kind: rest.kind };
  // boolean flags: fill defaults so undefined !== false doesn't break equals
  out.unsigned = rest.unsigned ?? false;
  out.tz = rest.tz ?? false;
  if (rest.element) out.elementNullable = rest.elementNullable ?? true;
  // unconstrained numeric params stay absent (absent = unconstrained)
  for (const k of ['bits', 'precision', 'scale', 'length', 'collation', 'charset', 'intervalFields', 'values', 'bounds', 'name', 'schema'] as const) {
    if (rest[k] !== undefined) out[k] = rest[k];
  }
  if (rest.element) out.element = normalize(rest.element);
  if (rest.subtype) out.subtype = normalize(rest.subtype);
  if (rest.fields) out.fields = rest.fields.map(f => ({ name: f.name, type: normalize(f.type), ...(f.nullable !== undefined ? { nullable: f.nullable } : {}) }));
  return out as DyadType;
}

/** Structural equality ignoring native metadata. */
export function equals(a: DyadType, b: DyadType): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
