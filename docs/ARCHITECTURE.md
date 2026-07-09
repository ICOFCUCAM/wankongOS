# Architecture

WankongOS is a modular monorepo. The guiding rule is **dependencies point one way
and every layer is replaceable**: apps depend on packages, `agents` and `store`
depend on `core`, and `core` depends on nothing. No layer imports upward, and no
layer reaches around its neighbour (an app never imports a vendor SDK; it goes
through `agents`).

```
            ┌───────────────┐      ┌───────────────┐
   apps →   │  apps/web      │      │  apps/api      │
            │  (Next.js)     │──────▶  (Hono REST)   │
            └───────────────┘ HTTP └───────┬───────┘
                                            │
              ┌─────────────────────────────┼─────────────────────┐
              ▼                              ▼                      ▼
        ┌───────────┐              ┌────────────────┐      ┌────────────┐
 pkgs → │  agents    │             │     store       │      │   core     │
        │ (AI runtime)│────────────▶ (data layer)     │──────▶ (domain)   │
        └─────┬─────┘   depends on └────────┬───────┘      └────────────┘
              └────────── depends on ───────┴──────────────────▶ core
```

## Packages

### `@wankong/core` — the domain
Pure, I/O-free. Zod schemas + inferred TypeScript types for every business object
(Organization, Department, Team, Employee, User, Task, Approval, Conversation,
Message, Memory, KnowledgeBase, Document, Goal, Integration, ApiKey, Webhook,
AuditEvent, Report). Plus the rules that govern them: role→permission expansion,
org-chart construction (cycle-safe), and KPI evaluation. Everything else speaks
these types, so the whole system shares one vocabulary.

### `@wankong/agents` — the AI runtime
One `AIProvider` interface; four backends — Anthropic, OpenAI, Google (all
`fetch`-based, no SDK lock-in), and a hermetic **`local`** provider that makes the
platform runnable and testable with zero credentials. A `ProviderRegistry` selects
among them, and `EmployeeRuntime` turns a domain `Employee` (identity + rules +
pinned model) into a streaming worker, assembling its system prompt and reporting
token usage. Tools are provider-neutral and gated on employee permissions.

### `@wankong/store` — the data layer
An async `Repository<T>` interface — deliberately shaped like a real database — with
a working `MemoryStore` implementation and a deterministic seed of the demo org.
Because the interface is async, `MemoryStore` swaps for a Postgres/Supabase-backed
store (see `schema.sql`) without any caller changing.

## Apps

### `@wankong/workflow` — the workflow engine
Interprets declarative node graphs (defined in core): employee steps, decisions,
parallel branches, connector calls, notifications, and human approvals that pause
and resume runs. Pure orchestration — persistence and side effects are injected.
See ADR-0006.

### `@wankong/knowledge` — chunking, embeddings, retrieval
An `Embedder` abstraction (hermetic local embedder + OpenAI seam), paragraph-aware
chunking, and cosine-ranked search returning citations. See ADR-0007.

### `@wankong/evals` — AI QA
Golden-task suites run through the real runtime, powering on-demand quality runs
and the regression gate on employee config edits. Schemas live in core. See ADR-0007.

### `apps/api` — REST API (Hono)
Transport only; all logic lives in the packages. Versioned `/v1` routes for every
object, permission checks at each sensitive route, Zod validation on every body,
audit events on mutations, and both buffered and SSE-streaming chat. The auth
middleware is the dev/demo path with a clean seam (`actorFor`) for real SSO/API keys.

### `apps/web` — console (Next.js App Router)
Server Components fetch from the API; a single client component streams chat over
SSE. Dark, minimal enterprise design. Pages: CEO dashboard (live metrics), employee
directory + org chart, employee profile + chat, task board.

## Cross-cutting decisions

- **Provider abstraction over lock-in.** No app or route names a vendor. See ADR-0002.
- **Permission-based access control.** Roles are named bundles of fine-grained
  permissions; every sensitive action checks one permission. See ADR-0003.
- **Multi-tenancy by `organization_id` + RLS.** Every business row is org-scoped;
  the production schema isolates tenants with Row-Level Security. See ADR-0004.
- **Hermetic by default.** The `local` provider + in-memory store mean `pnpm test`
  needs no network, keys, or database — CI is fast and deterministic. See ADR-0005.

## What is foundation vs. future

Built and tested end-to-end: the domain, the AI runtime, the data layer + seed, the
API, and the web console. Designed-for but not yet implemented: workflow execution,
embeddings/ingestion pipelines, integration connectors, billing, the marketplace,
and the admin/worker/mobile apps. Each lands at a boundary already defined here —
a new package or app — rather than a rewrite.
