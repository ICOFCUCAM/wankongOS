# ADR-0009: Postgres store behind the repository interface

- Status: Accepted
- Date: 2026-07-09

## Context

ADR-0005 promised the in-memory store could be swapped for a database without
touching callers. Serverless hosting (the live Vercel deployment) resets
in-memory state on cold starts, so durability is now the gating feature — but
tests must stay hermetic: no credentials, no external services in CI.

## Decision

**One `Store` interface, two implementations.** The shared surface is
`BaseStore`: abstract repositories plus every cross-entity helper implemented
once over `Repository<T>`. `MemoryStore` and `PgStore` both extend it, so they
cannot drift behaviourally.

**JSONB document tables.** `PgStore` stores each entity as a JSONB document
with `id` and `organization_id` lifted into indexed columns (one table per
entity kind, `wk_*`). `list()` filters in process after a scan — correct first,
adequate at current scale; hot queries move into SQL as they prove themselves.
The normalised `schema.sql` remains the fully-relational target for when SQL-
native features (pgvector recall, RLS policies per column) land.

**Driver abstraction, tested on real SQL.** A minimal `SqlClient` interface
separates the store from the driver: postgres.js (dynamically imported only
when `DATABASE_URL` is set) in production; **PGlite** — in-process WASM
Postgres — in tests. CI therefore exercises the exact production code path on
genuine Postgres semantics with zero infrastructure.

**Selection & boot.** `createAppContext` picks `PgStore` when `DATABASE_URL`
is configured (else the seeded `MemoryStore`), ensures the schema, and seeds
the demo org only when the database is empty — all behind a `ready` promise the
app middleware awaits, so requests never race initialisation. Seeds are
idempotent upserts on fixed ids.

## Consequences

- Setting `DATABASE_URL` (e.g. a Supabase pooled connection string in Vercel)
  turns on durability with no code changes; unset, everything behaves as before.
- The full API test suite runs against both stores; a behaviour difference is a
  failing test, not a production surprise.
- In-process predicate filtering trades query pushdown for interface fidelity —
  revisit per-table as row counts grow.
- PGlite adds a dev-only WASM dependency (~10 MB) to CI; accepted for hermetic
  real-SQL coverage.
