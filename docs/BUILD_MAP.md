# WankongOS — Build Map

The single source of truth for **what we are building, where each piece lives, and
what state it is in.** It translates the Master Build Directive into concrete,
bounded deliverables mapped to the monorepo's package/app boundaries, sequenced
into milestones. Update this file whenever a capability lands or a boundary changes
— it is the map, and it is meant to stay current.

**Legend:** ✅ Done (built + tested end-to-end) · 🟡 Partial (foundation in place,
depth pending) · ⬜ Planned (boundary defined, not yet built)

---

## 1. Architecture map — directive → boundary

Every module in the directive maps to exactly one package or app, so nothing is
tightly coupled and each is replaceable. `apps → packages`; `agents/store/workflow → core`.

| Directive module | Boundary | State |
| --- | --- | --- |
| Core objects & domain rules | `packages/core` | ✅ |
| AI provider abstraction | `packages/agents` | ✅ |
| Data layer / database | `packages/store` (+ `schema.sql`) | ✅ in-memory · ⬜ Postgres impl |
| Workflow engine | `packages/workflow` | ✅ engine · 🟡 visual builder |
| Memory system | `packages/store` (memories) + retrieval in `agents` | 🟡 |
| Knowledge system | `packages/store` (kb/docs) + `packages/knowledge` | 🟡 model · ⬜ ingestion/embeddings |
| Integrations | `packages/workflow/connectors` + `packages/integrations` | 🟡 framework · ⬜ real connectors |
| Notifications | audit-backed hook + `packages/notifications` | 🟡 · ⬜ delivery |
| Auth / RBAC / multi-tenancy | `packages/core` (permissions) + `packages/auth` | 🟡 model · ⬜ SSO/sessions |
| Billing | `packages/billing` | ⬜ |
| Analytics / observability | `packages/analytics` + API instrumentation | 🟡 dashboard · ⬜ tracing/cost |
| Design system / UI kit | `packages/design-system`, `packages/ui` | 🟡 in web · ⬜ extracted |
| REST API | `apps/api` | ✅ |
| Web console | `apps/web` | ✅ |
| Admin app | `apps/admin` | ⬜ |
| Background worker | `apps/worker` | ⬜ |
| Mobile app | `apps/mobile` | ⬜ |
| Marketplace | `apps/web` + `packages/marketplace` | ⬜ |

---

## 2. Capability status by directive section

### Organization model ✅
Organization → Department → Team → Employee → Task → Outcome, all typed in `core`,
seeded with **Acme Robotics** (11 AI employees, 10 departments) and served over the API
and web org chart.

### AI Employee system ✅
Identity, role, department, manager, description, responsibilities, objectives, KPIs,
tools, permissions, knowledge refs, availability, escalation & approval rules — all
modelled, seeded, and editable via the API. Employees run through the provider-agnostic
runtime. 🟡 *Performance history* (KPI readings over time) and 🟡 *inter-employee
messaging* beyond workflow delegation are next.

### Workflow engine ✅
Executable definitions with start / employee / decision / approval / notification /
integration / parallel / end nodes; retries, timeouts, conditions, loops (bounded),
parallel fan-out/join, and **human approvals that pause & resume**. Seeded
"Inbound Lead Handling" workflow runs end-to-end. 🟡 *Visual drag-and-drop builder*
and ⬜ *scheduled triggers* (needs `apps/worker`) remain.

### Memory system 🟡
Scoped memory (conversation/employee/department/organization) with importance scoring
and salience-ranked retrieval into prompts. ⬜ Embeddings, semantic search, pruning
policy, and the searchable timeline UI.

### Knowledge system 🟡
Knowledge bases + versioned documents + chunk model; retrieval wired into employee
prompts with citation-ready structure. ⬜ Ingestion (PDF/Word/Excel/CSV/Notion/Drive),
automatic embeddings, semantic search.

### Integrations 🟡
Connector framework with a pluggable registry and hermetic default handlers for 12
integration kinds, invoked from workflow integration nodes. ⬜ Credentialed connectors,
OAuth flows, inbound webhooks.

### Dashboard ✅
Live CEO dashboard: workforce, tasks pipeline, approvals, goals, AI utilization,
workflow runs, estimated hours saved (transparent formula). ⬜ Revenue, live event
stream, human-utilization split.

### Security 🟡
Permission-based least-privilege access on every route; per-tenant scoping (404 on
cross-org); audit log on mutations; `schema.sql` with RLS. ⬜ Encryption at rest,
secrets manager, rate limiting, prompt-injection defenses, backups/DR.

### Observability 🟡
Structured audit trail, workflow run/step history, token accounting per message.
⬜ Metrics/tracing exporters, AI cost & latency dashboards, failure analytics.

### APIs ✅ (core) / ⬜ (surface)
Versioned `/v1` REST for every object. ⬜ OpenAPI doc generation, API-key auth,
OAuth, outbound webhook delivery, SDK.

### Billing ⬜ · Marketplace ⬜ · Admin/Worker/Mobile ⬜
Boundaries defined above; not yet started.

---

## 3. Milestone sequencing

- **M0 — Foundation** ✅ monorepo, core domain, provider abstraction, store + seed, API, web console.
- **M1 — Workflow engine** ✅ executable workflows with approvals, connectors, and the runs UI.
- **M2 — Knowledge & memory** 🟡→ ingestion pipeline, embeddings + vector search (pgvector),
  citations in chat, memory timeline. *(next)*
- **M3 — Real persistence & auth** → Postgres/Supabase repository behind the existing
  interface (ADR-0005), sessions + SSO-ready auth, invitation flow, API keys.
- **M4 — Integrations & worker** → credentialed connectors, OAuth, `apps/worker` for
  scheduled/queued jobs and background workflow runs.
- **M5 — Observability & security hardening** → tracing, cost/latency analytics,
  rate limiting, prompt-injection defenses, backups.
- **M6 — Commercial surface** → billing, marketplace, `apps/admin`, `apps/mobile`.

Each milestone is one or more PRs into `main`; this map is updated as each lands.

---

## 4. Working agreements

- Every commit compiles (`pnpm typecheck`) and passes tests (`pnpm test`).
- No placeholders, no TODOs, no faked functionality — a capability is ✅ only when it
  runs end-to-end and is covered by a test.
- New cross-cutting decisions get an ADR in `docs/adr/`.
- New org-scoped tables carry `organization_id` + an RLS policy (ADR-0004).
- The platform stays runnable and testable fully offline (ADR-0002, ADR-0005).
