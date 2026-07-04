# ADR-0005: Hermetic data layer and tests

- Status: Accepted
- Date: 2026-07-04

## Context

Development rules require that every commit compiles and passes tests. Tests that
need a live database or model API are slow, flaky, and block contributors without
credentials.

## Decision

Ship an async `Repository<T>` interface with a working in-memory implementation
(`MemoryStore`) and a deterministic seed. Combined with the `local` AI provider
(ADR-0002), the entire platform — API, chat, dashboard — runs and is tested with no
network, keys, or database. The async interface is intentionally database-shaped so
a Postgres/Supabase implementation drops in behind it unchanged.

## Consequences

- `pnpm test` is fast, deterministic, and runs anywhere.
- The same code paths exercised in tests are the ones used in production; only the
  repository implementation and provider differ.
- The in-memory store is not durable — it is for dev, tests, and demos; production
  uses the SQL-backed implementation.
