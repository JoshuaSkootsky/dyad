# Dyad — Goals and Progress

## Vision

Dyad is a **portable, versioned database type/schema contract**. Its purpose is to capture RDBMS types without lowest-common-denominator loss, then let Reylo and other tools project that information into TypeScript, JSON Schema, DDL, documentation, and other formats.

```
RDBMS-native information → Dyad IR → explicitly defined consumers
```

Postgres is the reference implementation and proof that the model can handle difficult real-world types. It is not, by itself, proof of the cross-database superset claim.

Reylo is one prospective consumer, not the reason the IR exists. JSON Schema is a projection, not the canonical format.

## Central Invariant

> **Importing must not silently discard native type information. Exporting may lose information only through an explicit, documented projection.**

Qualifications:

- "Lossless" means **semantic round-tripping within a documented scope** — not preservation of original SQL spelling, formatting, comments, or every catalog implementation detail.
- Unknown and extension types must remain representable without an importer pretending to understand them. Information outside the documented scope must either be retained through an explicit `custom`/`native` representation or reported as unsupported; it must not be silently replaced by a guessed approximation.

Formally:

> For supported import paths, Dyad must preserve all native type information within its documented semantic scope. Information outside that scope must either be retained through an explicit native/custom representation or reported as unsupported; it must not be silently replaced by a guessed approximation.

## Core Design Tension

The difficult part is not representing many parameters — it is reconciling:

1. **Native fidelity** — preserving what a particular database actually declared and means.
2. **Native-agnostic comparison** — deciding when two types are semantically equivalent.

For example, `VARCHAR(255)` in SQLite does not have the same enforcement semantics as `varchar(255)` in Postgres. A shared structural representation is useful, but `equals()` must not accidentally imply that database behavior is identical.

## Goals

### G1: Lossless type capture
Capture every RDBMS type without silently discarding native information. Unknown/extension types get a `custom` representation with `native` metadata preserved.

**Status: Implemented (Postgres, SQLite, MySQL)**

Exit criteria:
- Postgres: all types in the supported-postgres matrix pass ingestion without silent loss. ✅
- SQLite: representative vertical slice passes, declared types preserved via affinity rules. ✅
- MySQL: representative vertical slice passes.

Sub-goals:
- [x] G1.1 — Tagged union `DyadType` with 19 kinds and parameterized fields
- [x] G1.2 — `custom` escape hatch with `native` (dialect, name, params, category)
- [x] G1.3 — `fromNative()` mapping for Postgres, MySQL, SQLite type names
- [x] G1.4 — `ref` kind for named types (enum, domain, composite, range)
- [x] G1.5 — Array element nullability (`elementNullable`)
- [x] G1.6 — Collation and charset on text types
- [x] G1.7 — Column metadata: defaults (literal vs expression), identity, generated, collation
- [x] G1.8 — SQLite affinity rules (declared type → affinity, original string preserved in `native`) ✅ NEW
- [x] G1.9 — MySQL type mapping (unsigned, SET, native enums, dialect-specific params) ✅ NEW
- [ ] G1.10 — Extension types with category hints (citext, hstore, ltree) — untested (not available in PGlite)

### G2: Canonical structural comparison
Define `normalize()` and `equals()` as operations over Dyad's IR. Equality means canonical IR equivalence under documented rules. It does NOT imply identical database enforcement, runtime behavior, or consumer compatibility.

Cross-database semantic compatibility (whether two types behave identically, can be substituted in migration, produce the same TypeScript type, etc.) is a separate, possibly future, consumer-specific concern.

**Status: Implemented and tested (Postgres)**

Exit criteria: written specification plus positive, negative, and edge-case tests. Not "100%" based on coverage alone.

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

**Status: In progress (SQLite and MySQL done)**

Exit criteria: representative vertical slices for MySQL and SQLite pass; unresolved differences are explicitly represented in the IR.

Sub-goals:
- [x] G6.1 — SQLite parser (affinity rules, declared type preservation, FKs, defaults) ✅ NEW
- [x] G6.2 — MySQL parser (vertical slice: unsigned, SET, native enum, dialect params) ✅ NEW
- [ ] G6.3 — Cross-database equality semantics documented
- [ ] G6.4 — Representative type matrix for each dialect (SQLite matrix pending)
- [ ] G6.5 — Verify no IR changes needed after MySQL/SQLite slices

### G7: Contract lock
Freeze the initial public contract with compatibility guarantees.

**Status: Not started**

Exit criteria: compatibility fixtures frozen; versioning, evolution, unknown-kind handling, and consumer obligations documented.

Sub-goals:
- [ ] G7.1 — Format/schema version in serialized output (`irVersion` already exists)
- [ ] G7.2 — Serialized JSON fixtures as compatibility tests
- [ ] G7.3 — Document normalization and equality semantics (partially done in README)
- [ ] G7.4 — Specify consumer handling of unknown custom types and future kinds
- [ ] G7.5 — Document what "lossless" means (semantic round-trip, not SQL spelling)

Note: contract *versioning* (adding `irVersion`) should happen before contract *locking*. Versioning is an implementation detail; locking is a compatibility guarantee.

### G8: JSON Schema export
Lossy projection for tooling and publication.

**Status: Not started**

Exit criteria: export works for all IR kinds; unsupported/approximated cases documented.

Sub-goals:
- [ ] G8.1 — `zod-to-json-schema` export
- [ ] G8.2 — Document approximated/unsupported cases
- [ ] G8.3 — Verify export doesn't claim round-trip fidelity

### G9: Consumer probe (Reylo)
Validate the contract is useful to a consumer before freezing.

**Status: Not started**

Exit criteria: a thin read-only probe demonstrates the contract doesn't force consumers into inefficient or awkward usage.

Sub-goals:
- [ ] G9.1 — Native type resolution for prepared query columns and parameters
- [ ] G9.2 — Named enum and domain references
- [ ] G9.3 — Arrays and custom types
- [ ] G9.4 — Input vs output TypeScript projections
- [ ] G9.5 — Caching and partial schema loading
- [ ] G9.6 — Behavior for unknown types

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

These non-goals protect the project from being judged against problems it is not trying to solve.

## Recommended Ordering

1. **Finish the current Postgres boundary** — complete dependency-aware emission and shuffled-order round trips. Cover domains, enums, composites, ranges, arrays, and invalid graphs. Close this known hole.
2. **Specify the core semantics** — define semantic losslessness, normalization, canonical equality, native/custom representation, unsupported-feature behavior. Add an explicitly experimental serialization version.
3. **Run representative MySQL and SQLite vertical slices** — prioritize cases that challenge the IR, not broad but shallow parser coverage. SQLite: declared types vs affinity. MySQL: unsigned, native enum/set, dialect modifiers.
4. **Run a thin consumer probe (Reylo)** — projection, reference resolution, caching, unknown-type behavior. Keep query inference and driver policy outside Dyad.
5. **Lock the initial public contract** — freeze compatibility fixtures. Document versioning, evolution, unknown-kind handling, consumer obligations.
6. **Add JSON Schema as a documented lossy projection** — build the fuller Reylo adapter against that contract.

If maintaining momentum matters more than closing the Postgres emitter immediately, steps 1 and 3 can be swapped. But do not describe the Postgres boundary as finished while G5 remains open.

## Progress Summary

| Goal | Status | Notes |
|---|---|---|
| G1 Lossless type capture | Implemented (Postgres, SQLite, MySQL) | MySQL vertical slice done |
| G2 Canonical structural comparison | Implemented and tested | Postgres-only evidence |
| G3 Postgres catalog import | Implemented and hardened | Supported-postgres matrix |
| G4 Test matrix | Hardened | 33/33 pass, 3 skipped |
| G5 Dependency-aware emission | Implemented and tested | Cycle handling in emitter pending |
| G6 Cross-database superset | In progress | SQLite and MySQL vertical slices done |
| G7 Contract lock | Not started | Versioning can start now |
| G8 JSON Schema export | Not started | After IR is stable |
| G9 Consumer probe (Reylo) | Not started | Before contract lock |
| G10 Reylo adapter | Not started | Separate package |

The strongest strategic move is to let small MySQL and SQLite importer slices challenge the IR before committing to its public shape. That tests the central superset claim more effectively than another export format.