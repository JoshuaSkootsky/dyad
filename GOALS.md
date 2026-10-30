# Dyad — Goals and Progress

## Vision

Dyad is a **portable, versioned database type contract** (a "type IR"). Its purpose is to capture RDBMS types without lowest-common-denominator loss, then let Reylo and other tools project that information into TypeScript, JSON Schema, DDL, documentation, and other formats.

Note: "type IR," not "schema IR." dyad captures types, not schema-level constructs (indexes, constraints, views, comments). Those are out of scope (see Non-Goals). The name "dyad type IR" avoids dragging LLVM baggage into conversations and is harder to dismiss as derivative.

```
RDBMS-native information → Dyad IR → explicitly defined consumers
```

Postgres is the reference implementation and proof that the model can handle difficult real-world types. It is not, by itself, proof of the cross-database superset claim.

Reylo is one prospective consumer, not the reason the IR exists. JSON Schema is a projection, not the canonical format.

## Prior Art and Positioning

dyad is a re-derivation of patterns that exist independently in other ecosystems. This is stated explicitly because reviewers familiar with the space will recognize the lineage, and a re-derivation that shows its sources is far more defensible than one that doesn't.

### Closest siblings

- **Prisma's `sql_schema_describer`** (Rust) — the same project, already built at scale. `SqlSchema` with per-dialect modules (`postgres`, `mysql`, `mssql`, `sqlite`), `Column`, `ColumnType`, `ColumnTypeFamily`, `ColumnArity`, `UserDefinedType`, `EnumId`/`UdtId`, `DefaultValue`/`DefaultKind`, then a separate `datamodel-renderer` crate that projects the IR to PSL. Their introspection result carries a `warnings` field — they solved the "how do I tell the user my projection lost something" problem (our G7) with a per-import warnings channel rather than a schema-level invariant. Their IR is `family` + `native_type` string + arity — they started with more structure and collapsed it. dyad's `DyadType` + `native` escape hatch is the same two-layer shape, with more semantics promoted into the typed layer. Worth reading their commits to see what got demoted and why.

- **Atlas (ariga)** — closest on the round-trip claim. `schema.Type` interface, per-driver `TypeRegistry` of `TypeSpec`s with declared attributes (`size`, `precision`, `scale`, `unsigned`, `values`, `len`), referenced types for enums/composites/domains in Postgres, and `FormatType`/`ParseType` as an explicit parse/format pair. They **shipped "virtual types" (a portable cross-database type superset) and then pulled them**, reverting HCL to dialect-specific types with a note that documents are tied to engine+version. That is a documented negative result on exactly dyad's cross-database superset claim. dyad must either answer their objection or stop calling it a superset.

- **sqlc** — closest on the many-producers/many-consumers boundary. `internal/sql/ast` + `internal/catalog`, then a compiler, then codegen plugins. When they let an external dialect in, they deliberately **refused to expose their internal AST** and defined a narrow "here are the resolved columns and their types" contract, precisely because a new dialect might not be expressible in existing AST nodes. Same failure mode our 19-kinds enum will hit on the fourth database.

### Type-IR lineage

| Prior art | What it gives dyad |
|---|---|
| **Substrait `type.proto`** | Best formal precedent for the core shape: `Type` oneof, parameters per class (`DECIMAL<P,S>`, `VARCHAR<L>`), `type_variation_reference` for "same class, different representation", user-defined types via extension anchors, `unbound` as explicit placeholder. Read before finalizing `kind`. |
| **Apache Arrow / Iceberg / Parquet** | The canonical "logical type + physical/converted type + extension metadata" split — our params-on-type-plus-native-hatch decision, in production for a decade. |
| **MLIR** | The dialect model — a small verified core plus per-dialect extensions — is the mature answer to "one IR, many sources." Also provides vocabulary: *verified*, *canonicalized*, *lowered*, *unregistered dialect*, *round-trip*. Better analogy than LLVM IR. |
| **Avro / Protobuf descriptors / Confluent Schema Registry** | Prior art for G7: versioned schemas, compatibility modes (backward/forward/full), unknown-field preservation. Protobuf's "preserve unknown fields" is the mechanism G7 unknown-kind handling needs. |
| **`information_schema` (SQL:2003+), JDBC `DatabaseMetaData.getTypeInfo`, ODBC/ADO.NET type codes** | The original attempted cross-vendor superset, ~1996–2001. Their failure modes are our failure modes: vendor code passthrough and a catch-all `OTHER`/`NullType`. The SQL standard's own type model (distinct types, structured types, collection types) is roughly our kind list. We are re-deriving a standard. |
| **SQLAlchemy `TypeEngine` + dialect `with_variant`/`dialect_impls`, Alembic's `compare_type`** | Our `equals()` and its known false negatives (ref ≠ text) are Alembic's `compare_type` problem verbatim. A decade of issue-tracker scar tissue on which comparisons you cannot make. |
| **OMG CWM (2001), schema-mapping literature, bidirectional-transformation "lens laws" (GetPut/PutGet)** | The vocabulary for G7. Our invariant is a lens law statement. |
| **supabase/postgres-meta, SchemaSpy, Drizzle's `dataType`/`columnType` split, Kanel** | JSON-IR-crossing-a-process-boundary, and the in-ecosystem precedent colinhacks already knows: Drizzle's `columnType` (native string) + `dataType` (canonical) is our two-layer design in 40 lines of TS. |

### The framing that actually matters

The prior art splits into two camps:

- **Portable-first, lossy:** ent, Drizzle, Prisma's PSL, Atlas's abandoned virtual types. One logical type per field, each dialect projects it. Great ergonomics, no faithful round-trip.
- **Faithful-first, dialect-bound:** Atlas post-revert, `pg_dump`, SQLAlchemy reflection. Round-trips exactly, no portability.

dyad claims both, with the escape hatch as the seam. That claim is defensible **only if stated as an asymmetry**:

> The native string is ground truth. Canonical fields are a derived index over it. Comparison is over the index. Emission is from the native string unless a projection is explicitly requested.

This is a stronger position than "lossless type capture," because the canonical layer is provably lossy by construction — and it's the same position Atlas's `sql()` and Prisma's `native_type` independently arrived at.

### What is actually novel

Not the IR, not the parsers, not the topological sort, not lossy JSON Schema projection. Those all have prior art.

Genuinely thinner on prior art: a **Zod-validated, JSON-serializable IR in TypeScript with a formal `equals()` and a consumer-probe harness** — an IR whose *contract* is executable and versioned in the same language as its consumers. Prisma's describer is Rust-internal and private; Atlas's spec is Go + HCL; sqlc's catalog isn't exposed as a stable interchange format. Nobody in the JS ecosystem has published "here is a versioned, schema-validated, serializable schema IR with a spec." That's a real gap, especially with Zod as the validation layer, because it makes the contract lock (G7) nearly free: `z.discriminatedUnion` on `kind` *is* the unknown-kind policy, and a `z.unknown()` passthrough on `native` is the forward-compat story.

So: the pitch leads with "we re-derived Prisma's describer and Atlas's type registry; here's what we kept, what we changed, and the executable contract." Reviewers respect a re-derivation that shows its sources far more than one that doesn't.

## Central Invariant

> **Importing must not silently discard native type information. Exporting may lose information only through an explicit, documented projection.**

Lens law formulation (Get = import, Put = export):

- **PutGet holds** (up to `normalize()`): `import(export(ir)) == ir`. This is what the round-trip tests verify.
- **GetPut fails by design**: `export(import(db)) != db`, because SQL spelling, quoting, and default expression text are not preserved. This is the honest concession.

Qualifications:

- "Lossless" means **semantic round-tripping within a documented scope** — not preservation of original SQL spelling, formatting, comments, or every catalog implementation detail.
- Unknown and extension types must remain representable without an importer pretending to understand them. Information outside the documented scope must either be retained through an explicit `custom`/`native` representation or reported as unsupported; it must not be silently replaced by a guessed approximation.

Formally:

> For supported import paths, Dyad must preserve all native type information within its documented semantic scope. Information outside that scope must either be retained through an explicit native/custom representation or reported as unsupported; it must not be silently replaced by a guessed approximation.

The asymmetry: native string is ground truth; canonical fields are a derived index; comparison is over the index; emission is from the native string unless a projection is explicitly requested.

The asymmetry: native string is ground truth; canonical fields are a derived index; comparison is over the index; emission is from the native string unless a projection is explicitly requested.

## Core Design Tension

The difficult part is not representing many parameters — it is reconciling:

1. **Native fidelity** — preserving what a particular database actually declared and means.
2. **Native-agnostic comparison** — deciding when two types are semantically equivalent.

For example, `VARCHAR(255)` in SQLite does not have the same enforcement semantics as `varchar(255)` in Postgres. A shared structural representation is useful, but `equals()` must not accidentally imply that database behavior is identical.

`equals()` means: canonical IR equivalence under documented rules. It does NOT imply identical database enforcement, runtime behavior, or consumer compatibility. Cross-database semantic compatibility is a separate, consumer-specific concern.

## Goals

### G1: Lossless type capture
Capture every RDBMS type without silently discarding native information. Unknown/extension types get a `custom` representation with `native` metadata preserved.

**Status: Implemented (Postgres, SQLite, MySQL)**

Exit criteria:
- Postgres: all types in the supported-postgres matrix pass ingestion without silent loss. ✅
- SQLite: representative vertical slice passes, declared types preserved via affinity rules. ✅
- MySQL: representative vertical slice passes. ✅

Sub-goals:
- [x] G1.1 — Tagged union `DyadType` with 19 kinds and parameterized fields
- [x] G1.2 — `custom` escape hatch with `native` (dialect, name, params, category)
- [x] G1.3 — `fromNative()` mapping for Postgres, MySQL, SQLite type names
- [x] G1.4 — `ref` kind for named types (enum, domain, composite, range)
- [x] G1.5 — Array element nullability (`elementNullable`)
- [x] G1.6 — Collation and charset on text types
- [x] G1.7 — Column metadata: defaults (literal vs expression), identity, generated, collation
- [x] G1.8 — SQLite affinity rules (declared type → affinity, original string preserved in `native`)
- [x] G1.9 — MySQL type mapping (unsigned, SET, native enums, dialect-specific params)
- [ ] G1.10 — Extension types with category hints (citext, hstore, ltree) — untested (not available in PGlite)

### G2: Canonical structural comparison
Define `normalize()` and `equals()` as operations over Dyad's type IR. Equality means canonical IR equivalence under documented rules. It does NOT imply identical database enforcement, runtime behavior, or consumer compatibility.

Cross-database semantic compatibility (whether two types behave identically, can be substituted in migration, produce the same TypeScript type, etc.) is a separate, possibly future, consumer-specific concern.

**Status: Implemented and tested (Postgres)**

Note on implementation: `DyadType`'s TypeScript interface is hand-written alongside the Zod schema because TypeScript cannot infer recursive types from `z.lazy()` without a type annotation. The Zod schema is the source of truth; the hand-written type mirrors it. Drift is mitigated by `.passthrough()` (forward compat) and documented here. colinhacks will ask about this; the honest answer is "recursive schemas require an annotation, but the exported type is `z.infer`-derived."

Exit criteria: written specification plus positive, negative, and edge-case tests.

Sub-goals:
- [x] G2.1 — `normalize()` strips native metadata, fills boolean defaults
- [x] G2.2 — `equals()` compares canonical forms (JSON.stringify of normalized)
- [x] G2.3 — Negative tests: ref ≠ text, int32 ≠ int64, undefined vs false normalized
- [x] G2.4 — Documented contract in GOALS.md and README
- [ ] G2.5 — Decide if multiple equality relations are needed (consumer-specific, behavioral)

### G3: Postgres catalog import
Parse Postgres system catalogs into Dyad IR. "Complete" means all types and cases in the supported-postgres matrix, not "all of Postgres."

**Status: Implemented and hardened**

Exit criteria: all types in the supported-postgres matrix pass ingestion without silent loss, with documented coverage boundaries.

Sub-goals:
- [x] G3.1 — `format_type()` for built-in types (not hand-decoding `atttypmod`)
- [x] G3.2 — `pg_type.typtype`/`typelem` for named types and arrays (search_path-independent)
- [x] G3.3 — Joins `pg_attribute` + `pg_type` + `pg_collation` + `pg_attrdef` (no `information_schema`)
- [x] G3.4 — Array detection via `typcategory = 'A'` or `typlen = -1 AND typelem <> 0`
- [x] G3.5 — Serial detection via `pg_get_serial_sequence()` (owned sequences only, checks `attidentity` first)
- [x] G3.6 — Default classifier: quoted literals, numbers, booleans, nulls, expressions (anchored)
- [x] G3.7 — Collation only when differs from type default
- [x] G3.8 — Generated columns: `s` (stored) and `v` (virtual, PG18+)
- [x] G3.9 — Enums (labels from `pg_enum`), composites, domains (base type ref), ranges
- [x] G3.10 — Named types in non-public schemas
- [x] G3.11 — Search_path independence verified
- [ ] G3.12 — Virtual generated columns (needs PG18, PGlite is PG17)
- [ ] G3.13 — Extension types (citext, hstore, ltree — not available in PGlite)

### G4: Test matrix
Prove the parser handles real-world edge cases.

**Status: Hardened (33/33 pass, 3 skipped)**

Exit criteria: table-driven matrix with one DDL snippet and one expected IR fragment per case; all supported cases pass.

Sub-goals:
- [x] G4.1 — Happy-path matrix (26 columns, all pass)
- [x] G4.2 — Round-trip test (DDL → IR → DDL → IR, enums survive as refs)
- [x] G4.3 — Default classifier cases (11 cases, all pass)
- [x] G4.4 — format_type edge cases (11 cases, all pass)
- [x] G4.5 — Negative equals tests (3 cases, all pass)
- [x] G4.6 — Search_path independence (2 paths, equals passes)
- [x] G4.7 — Table-driven matrix (33 cases across defaults, named types, arrays, built-ins, collation, identifiers)
- [ ] G4.8 — Round-trip tests for domains, composites, ranges, multi-dim arrays
- [ ] G4.9 — Collation explicit test with real locale
- [ ] G4.10 — Topological sort verification with shuffled registry order

### G5: Dependency-aware Postgres schema emission and round-tripping
Emit types in dependency order so domains over enums, composites containing domains, and arrays of either are created correctly.

**Status: Implemented and tested**

Exit criteria: shuffled registry order round-trips correctly; cycles handled gracefully.

Sub-goals:
- [x] G5.1 — Dependency extraction (ref, array element, struct fields, range subtype)
- [x] G5.2 — Topological sort (DFS-based)
- [x] G5.3 — Cycle detection (warns, doesn't crash)
- [x] G5.4 — Verified: enum → domain → composite ordering
- [ ] G5.5 — Handle cycles in emitter (skip or error gracefully)
- [ ] G5.6 — Integrate into round-trip emitter (done in roundtrip-pg.ts)

### G6: Cross-database superset claim
Prove the IR generalizes beyond Postgres.

**Status: In progress (SQLite + MySQL done)**

Exit criteria: representative vertical slices for MySQL and SQLite pass; unresolved differences are explicitly represented in the IR.

**Atlas caveat:** Atlas shipped "virtual types" (portable cross-database type superset) and then pulled them, reverting to dialect-specific types. This is a documented negative result on the superset claim.

**The answer (scope distinction):** Atlas's virtual types were an *authoring surface* — the portable type was the source of truth for HCL documents and therefore for migration emission. That's why engine+version coupling killed them: a portable type as ground truth produces wrong DDL.

dyad's canonical layer is a *query surface* — a derived index used for comparison and read-only consumers. Nothing is ever emitted from it. The failure mode Atlas hit (portable type as ground truth → wrong DDL) is structurally unavailable to dyad.

**Scope boundary:** dyad's superset claim is a *reading superset*, not a *translation superset*. If Reylo only reads, that's sufficient. If anyone ever asks dyad to emit MySQL DDL from a Postgres-parsed IR, the answer is no by design. This is a non-goal, not an unstated implication.

Sub-goals:
- [x] G6.1 — SQLite parser (affinity rules, declared type preservation, FKs, defaults)
- [x] G6.2 — MySQL parser (vertical slice: unsigned, SET, native enum, dialect params)
- [ ] G6.3 — Cross-database equality semantics documented
- [ ] G6.4 — Representative type matrix for each dialect
- [ ] G6.5 — Verify no IR changes needed after MySQL/SQLite slices

### G7: Contract lock
Freeze the initial public contract with compatibility guarantees.

**Status: Not started**

Exit criteria: compatibility fixtures frozen; versioning, evolution, unknown-kind handling, and consumer obligations documented.

**Reframed per prior-art analysis:** G7's deliverable is "publish the Zod schema as the spec." `z.discriminatedUnion` on `kind` *is* the unknown-kind policy; `z.unknown()` passthrough on `native` is the forward-compat story. This is much cheaper than originally framed.

Sub-goals:
- [x] G7.1 — Format/schema version in serialized output (`irVersion` already exists)
- [ ] G7.2 — Serialized JSON fixtures as compatibility tests
- [x] G7.3 — Document normalization and equality semantics (lens law: PutGet holds, GetPut fails by design)
- [x] G7.4 — `.passthrough()` on all IR objects preserves unknown fields (forward compat)
- [ ] G7.5 — Forward-compat test: unknown kinds rejected by `z.enum` (documented limitation)
- [ ] G7.6 — Version envelope: `irVersion` outside `Database` so v1 readers can read version of unparseable payloads
- [ ] G7.7 — Property-test `normalize()` idempotence and `equals()` reflexivity/symmetry

Note: contract *versioning* (adding `irVersion`) should happen before contract *locking*. Versioning is an implementation detail; locking is a compatibility guarantee.

### G8: JSON Schema export
Lossy projection for tooling and publication.

**Status: Implemented**

Exit criteria: export works for all IR kinds; unsupported/approximated cases documented. ✅

Sub-goals:
- [x] G8.1 — `typeToJsonSchema`, `columnToJsonSchema`, `tableToJsonSchema`, `databaseToJsonSchema` implemented
- [x] G8.2 — x-dyad-* annotations preserve native info; nullable via type array; documented as lossy projection
- [ ] G8.3 — Verify export doesn't claim round-trip fidelity (documented in README)

### G9: Consumer probe (Reylo)
Validate the contract is useful to a consumer before freezing.

**Status: Implemented (TypeScript projection)**

Exit criteria: a thin read-only probe demonstrates the contract doesn't force consumers into inefficient or awkward usage. ✅

Sub-goals:
- [x] G9.1 — Native type resolution for prepared query columns and parameters (via typeToTs)
- [x] G9.2 — Named enum and domain references (ref → sanitizeTypeName)
- [x] G9.3 — Arrays and custom types (array → TS arrays, custom → unknown with native comment)
- [x] G9.4 — Input vs output TypeScript projections (nullable handling, optional properties)
- [ ] G9.5 — Caching and partial schema loading
- [ ] G9.6 — Behavior for unknown types (custom → unknown, documented)

### G10: Reylo adapter
Full integration with Reylo's inference engine.

**Status: Not started (separate package)**

Sub-goals:
- [ ] G10.1 — Adapter package (subpath export, not in core)
- [ ] G10.2 — Convert live catalog rows to `Database` descriptors
- [ ] G10.3 — Integration tests with real Reylo workflow

## Non-Goals

Dyad does not inherently provide:

- SQL query inference or parsing
- Query nullability or cardinality analysis
- Migration planning or schema diffing
- One universal TypeScript mapping
- Proof that structurally similar types behave identically across databases
- Lossless JSON Schema or DDL export to every target
- Preservation of SQL formatting, spelling, or comments
- Emitting DDL for one database from an IR parsed from another (translation superset) — dyad is a reading superset only

These non-goals protect the project from being judged against problems it is not trying to solve.

## Recommended Ordering

1. **Finish the current Postgres boundary** — complete dependency-aware emission and shuffled-order round trips. Cover domains, enums, composites, ranges, arrays, and invalid graphs. Close this known hole.
2. **Specify the core semantics** — define semantic losslessness, normalization, canonical equality, native/custom representation, unsupported-feature behavior. Add an explicitly experimental serialization version.
3. **Run representative MySQL and SQLite vertical slices** — prioritize cases that challenge the IR, not broad but shallow parser coverage. SQLite: declared types vs affinity. MySQL: unsigned, native enum/set, dialect modifiers. ✅ Done.
4. **Run a thin consumer probe (Reylo)** — projection, reference resolution, caching, unknown-type behavior. Keep query inference and driver policy outside Dyad. ✅ Done (TypeScript projection).
5. **Lock the initial public contract** — freeze compatibility fixtures. Document versioning, evolution, unknown-kind handling, consumer obligations.
6. **Add JSON Schema as a documented lossy projection** — build the fuller Reylo adapter against that contract. ✅ Done.

If maintaining momentum matters more than closing the Postgres emitter immediately, steps 1 and 3 can be swapped. But do not describe the Postgres boundary as finished while G5 remains open.

## Progress Summary

| Goal | Status | Notes |
|---|---|---|
| G1 Lossless type capture | Implemented (Postgres, SQLite, MySQL) | All three dialects |
| G2 Canonical structural comparison | Implemented and tested | Postgres-only evidence |
| G3 Postgres catalog import | Implemented and hardened | Supported-postgres matrix |
| G4 Test matrix | Hardened | 33/33 pass, 3 skipped |
| G5 Dependency-aware emission | Implemented and tested | Cycle handling in emitter pending |
| G6 Cross-database superset | In progress | All three dialects parsed; superset claim needs Atlas objection answered |
| G7 Contract lock | Not started | Versioning can start now; Zod schema IS the spec |
| G8 JSON Schema export | Implemented | Lossy projection with x-dyad annotations |
| G9 Consumer probe (Reylo) | Implemented | TypeScript projection from IR |
| G10 Reylo adapter | Not started | Separate package |

The strongest strategic move is to let small MySQL and SQLite importer slices challenge the IR before committing to its public shape. That tests the central superset claim more effectively than another export format.

### What's actually novel

Not the IR, not the parsers, not the topological sort, not lossy JSON Schema projection. Those all have prior art (Prisma's describer, Atlas's type registry, Substrait, Arrow).

Genuinely thinner on prior art: a **Zod-validated, JSON-serializable IR in TypeScript with a formal `equals()` and a consumer-probe harness** — an IR whose *contract* is executable and versioned in the same language as its consumers. Nobody in the JS ecosystem has published "here is a versioned, schema-validated, serializable schema IR with a spec." That's a real gap, especially with Zod as the validation layer, because it makes the contract lock (G7) nearly free.