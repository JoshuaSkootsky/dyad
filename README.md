# dyad

A serializable **superset type system** for major RDBMS types (Postgres, MySQL, SQLite), intended as the public type IR for [Reylo](https://github.com/colinhacks/reylo)'s inference engine.

## Why
Existing formats (Protobuf, Avro, Arrow, JSON Schema) optimize for *data on the wire* and collapse to a lowest-common-denominator type set. A database inference engine needs the opposite: parameterized, dialect-aware, lossless descriptors like `varchar(255)`, `numeric(10,2)`, `timestamp(3) with time zone`, `interval year to month`, typed `json`, and arrays/structs.

## Design
- `DyadType` is a tagged union on `kind`:
  `int` (bits 8/16/24/32/64, unsigned), `decimal`, `float`, `double`,
  `char`/`varchar`/`text` (collation, charset), `bytes`, `bool`,
  `date`, `time`/`timestamp` (tz), `interval`,
  `uuid`, `json`, `array` (elementNullable), `struct`, `enum`, `range`, `ref`,
  `custom` (category hint), `unknown`.
- Parameters live on the type itself: `precision`, `scale`, `length`, `tz`, `intervalFields`, `bounds`.
- Nullability lives on `Column` / struct fields / array-element flags — not on the type (type = value shape).
- `Column` carries `default` (literal vs expression), `identity`, `generated` (stored/virtual), column-level `collation`.
- `Database` has a `version` field, `dialect`, `tables`, and a `types` registry (enum/domain/composite/range) for `ref` and recursion.
- `custom` + `native` escape hatch preserves unmapped native types (Postgres inet, hstore, PostGIS, etc.) losslessly with a category hint.
- `normalize()` strips native metadata; `equals()` compares canonical forms (so `int4` == `integer`).

## SQLite handling
Declared types are free text; `fromNative('sqlite', ...)` maps via affinity rules and always retains the original declared string in `native`.

## Usage
```ts
import { Database, fromNative, normalize, equals } from 'dyad';

const db = Database.parse({ version: '1', dialect: 'postgres', tables: [...] });
const t = fromNative('postgres', 'numeric', [10, 2]); // { kind: 'decimal', precision: 10, scale: 2, native: {...} }
equals(t, fromNative('postgres', 'numeric', [10, 2])); // true
```

## Status
v0.3.0 — schema + native mapping + normalize/equals + **Postgres catalog parser** (subpath export `dyad/postgres`) + **SQLite catalog parser** (subpath export `dyad/sqlite`) + comprehensive test matrix.

### Postgres parser
- Uses `format_type(atttypid, atttypmod)` for built-ins; `pg_type.typtype`/`typelem` for named types and arrays (search_path-independent).
- Joins `pg_attribute` + `pg_type` + `pg_collation` + `pg_attrdef` (no `information_schema` — avoids hidden columns).
- Type resolution via `typtype` (e/d/c/r/m → ref; array of named → array of ref), not string matching.
- Array detection via `typcategory = 'A'` or `typlen = -1 AND typelem <> 0` (avoids false positives on `name`, `point`, `int2vector`).
- Serial detection via `pg_get_serial_sequence()` (owned sequences only, checks `attidentity` first).
- Default classifier: quoted literals, numbers, booleans, nulls, expressions (anchored, no misclassification).
- Collation only set when it differs from the type's default.
- Generated columns: `s` (stored) and `v` (virtual, PG18+).
- Handles enums (labels from `pg_enum`), composites, domains (base type ref), ranges via `typtype`.
- `parseDatabase(client, schema, name, serverVersion)` returns a full `Database` descriptor.

### SQLite parser (`dyad/sqlite`)
- Affinity rules: INT → int, TEXT/CHAR/CLOB → text/varchar, BLOB/none → bytes, REAL/FLOA/DOUB → double, NUMERIC/DECIMAL → decimal.
- Declared type string always preserved in `native` (lossless).
- Parameters (length, precision, scale) extracted from declared type when present.
- Defaults: quoted literals, numbers, booleans, nulls, expressions.
- Foreign keys via `PRAGMA foreign_key_list`.
- Primary keys via `PRAGMA table_info` pk flag.
- No named types (SQLite has no enums, domains, composites, ranges).
- `parseDatabase(client, dbName)` returns a full `Database` descriptor.

### Emitter
- Topological sort for named types (dependencies before dependents).
- Handles cycles (warns, doesn't crash).
- Domain over enum, composite containing domain, arrays of either all work.

### Tests
- `pglite.ts` — 26-column happy-path matrix (Postgres), all assertions pass.
- `basic.ts` — SQLite parser (8 assertions, all pass).
- `roundtrip-pg.ts` — DDL → IR → DDL → IR round-trip, enums survive as refs.
- `defaults.ts` — 11 default classifier cases (Postgres), all pass.
- `edge.ts` — 11 format_type edge cases, all pass.
- `negative.ts` — equals() can fail (ref ≠ text, int32 ≠ int64, undefined vs false normalized).
- `searchpath.ts` — IR identical across search_path values (equals passes).
- `matrix.ts` — 33 table-driven cases (Postgres), 33/33 pass, 3 skipped.
- `toposort.ts` — topological sort verification (enum → domain → composite).
- `roundtrip-pg.ts` — DDL → IR → DDL → IR round-trip, enums survive as refs.
- `defaults.ts` — 11 default classifier cases, all pass.
- `edge.ts` — 11 format_type edge cases (numeric(3,-2), intervals, "char", bit, arrays), all pass.
- `negative.ts` — equals() can fail (ref ≠ text, int32 ≠ int64, undefined vs false normalized).
- `searchpath.ts` — IR identical across search_path values (equals passes).

### Next
- JSON Schema export (`zod-to-json-schema`).
- MySQL and SQLite parsers.
- Round-trip tests for domains, composites, ranges, multi-dim arrays.
- Reylo adapter in a separate package.
- Round-trip tests (DDL → catalog → IR → DDL → catalog → IR) using PGlite or testcontainers.
- Reylo adapter in a separate package.