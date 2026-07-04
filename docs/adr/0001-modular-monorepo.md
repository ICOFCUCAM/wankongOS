# ADR-0001: Modular monorepo with one-directional dependencies

- Status: Accepted
- Date: 2026-07-04

## Context

WankongOS spans a domain model, an AI runtime, persistence, a REST API, and a web
console — and will grow to include admin/worker/mobile apps, billing, integrations,
and a marketplace. We need a structure where these evolve independently and nothing
becomes load-bearing by accident.

## Decision

Use a pnpm-workspaces monorepo split into `packages/*` (libraries) and `apps/*`
(deployables). Enforce a strict dependency direction: `apps → packages`, and within
packages `agents`/`store → core`; `core` depends on nothing. TypeScript project
references make the graph explicit and buildable incrementally.

## Consequences

- Any layer is replaceable behind its interface without touching neighbours.
- The domain (`core`) stays pure and reusable by every future app.
- Circular dependencies are structurally impossible.
- Slightly more boilerplate (per-package `package.json`/`tsconfig`) — accepted as
  the cost of clean boundaries.
