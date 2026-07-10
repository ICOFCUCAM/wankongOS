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
| Data layer / database | `packages/store` (+ `schema.sql`) | ✅ in-memory · ✅ Postgres (JSONB, ADR-0009) · ⬜ normalised SQL |
| Workflow engine | `packages/workflow` | ✅ engine · 🟡 visual builder |
| Memory system | `packages/core` (scoring/pruning) + `packages/store` | ✅ scoring/pruning/timeline · ⬜ vector recall |
| Knowledge system | `packages/knowledge` + `packages/store` | ✅ ingestion/embeddings/search/citations · ⬜ PDF/Word/connector sources |
| Integrations | `packages/workflow/connectors` + `packages/integrations` | 🟡 framework · ✅ MCP client · ⬜ SaaS connectors |
| Notifications | audit-backed hook + `packages/notifications` | 🟡 · ⬜ delivery |
| Auth / RBAC / multi-tenancy | `packages/core` (permissions) + `packages/auth` | 🟡 model · ⬜ SSO/sessions |
| Billing | `packages/billing` | ⬜ |
| AI QA / evaluations (§3.2) | `packages/evals` | ✅ golden suites + regression gate · ⬜ drift detection |
| Trust & governance (§3.1, §3.5) | `packages/core` policies + API/web | ✅ probation/kill switch/budgets/versioning · ⬜ reviews/canary |
| Analytics / observability | API instrumentation + `/v1/analytics` | ✅ cost/latency per employee · ⬜ tracing exporters |
| Design system / UI kit | `packages/design-system`, `packages/ui` | 🟡 in web · ⬜ extracted |
| REST API | `apps/api` | ✅ |
| Web console | `apps/web` | ✅ |
| Admin app | `apps/admin` | ⬜ |
| Background worker | `apps/worker` | ✅ scheduler loop · ⬜ queues/retries |
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
"Inbound Lead Handling" workflow runs end-to-end. ✅ *Scheduled triggers* (cron via
the scheduler tick / `apps/worker`). 🟡 *Visual drag-and-drop builder* remains.

### Memory system ✅ (core) / ⬜ (vector recall)
Scoped memory with salience scoring (importance × recency half-life), scored
retrieval into prompts, capacity-based pruning per owner (`POST /v1/memories/prune`),
and the per-employee memory timeline in API and console. ⬜ Embedding-based memory
recall (currently salience-ranked).

### Knowledge system ✅ (pipeline) / ⬜ (rich sources)
Full pipeline: ingestion (`POST /v1/documents`, text/markdown/CSV) → paragraph-aware
chunking → embeddings via an `Embedder` abstraction (deterministic local embedder,
OpenAI seam picked up from env) → semantic search (`POST /v1/knowledge/search`) →
**citations in chat replies** (API + UI). Re-ingest bumps document versions; seeded
embeddings backfill lazily on first search. ⬜ PDF/Word/Excel parsers and
Notion/Drive/SharePoint/Confluence source connectors (M4 connector framework).

### AI QA ✅ (suites + gate) / ⬜ (drift)
Golden-task suites per employee (`packages/evals`, schemas in core) run through the
real runtime; on-demand runs from the console; and the **regression gate**: a config
edit (prompt/title/model/…) that fails the employee's suite is rejected with 422 and
the failing report. Two seeded suites cover the Support Manager and Sales Director.
⬜ Drift detection over live outputs and cross-provider bake-off reports.

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

### Observability ✅ (core) / ⬜ (exporters)
Structured audit trail, workflow run/step history; every assistant turn records
provider, model, token counts, and latency; per-employee cost & latency analytics
(`GET /v1/analytics`) and dashboard cost/latency rows. ⬜ Metrics/tracing exporters,
failure analytics.

### APIs ✅ (core) / ⬜ (surface)
Versioned `/v1` REST for every object. ⬜ OpenAPI doc generation, API-key auth,
OAuth, outbound webhook delivery, SDK.

### Billing ⬜ · Marketplace ⬜ · Admin/Worker/Mobile ⬜
Boundaries defined above; not yet started.

---

## 3. Differentiators — what makes this the best AI-workforce OS for companies

The directive covers table stakes. These are the capabilities that make an
enterprise *trust* an AI workforce enough to scale it — the moat. Each is mapped
to a boundary and a milestone so it's a deliverable, not a slogan.

### 3.1 Trust & Governance (treat AI employees like real hires) 🟡 (core shipped)
The org already models approval/escalation rules; extend it into a full employment
lifecycle. *Boundary: `packages/core` (policy), `apps/api`, `apps/web`.*
- ✅ **Probation mode** — new hires start in status `training` and refuse real work;
  activation (`POST /employees/:id/activate`) requires PASSING the employee's eval
  suite. Trust is earned by evidence.
- ✅ **Budget caps** — `dailyTokenBudget` per employee is a hard ceiling: chat refuses
  with 429 once today's tokens are spent; usage surfaced on the profile.
- ✅ **Kill switch** — pause one employee or the whole workforce in one click
  (`POST /workforce/pause`); chat returns 409 and workflow steps fail visibly.
- ✅ **Performance reviews** — KPI-backed review records compiled from real activity
  (eval pass rate, task throughput, goals, conversations, config stability) with an
  evidence-stating narrative and rating; generated on demand from the profile.
- ⬜ **Sandbox trials** — dry-run candidates against recorded tasks before live access.

### 3.2 Evaluation & Quality — AI QA ✅ (suites + gate shipped in M2)
No company promotes an untested human; same rule for AI. *Boundary: new
`packages/evals`, wired into CI and the console.*
- **Golden-task suites** per employee: curated input → expected-properties checks,
  run on demand and on every prompt/model/config change.
- **Regression gate** — a prompt edit that fails its suite can't go live.
- **Drift detection** — score live outputs over time; alert when quality slides.
- **Model bake-offs** — run the same suite across providers to choose per-role
  models on evidence, not vibes (the provider abstraction makes this nearly free).

### 3.3 ROI & FinOps — CFO-legible numbers ⬜ → M3
Token counts are already recorded; turn them into money. *Boundary:
`packages/analytics`, dashboard.*
- **Cost per task / per outcome**, rolled up by employee and department.
- **AI vs. human cost comparison** with explicit, editable assumptions
  (extending the transparent hours-saved formula already on the dashboard).
- **Budget enforcement** — caps from §3.1 surfaced as forecasts and alerts.

### 3.4 Compliance Pack — audit you can hand to an auditor 🟡 (evidence + PII shipped)
The audit trail and RLS design exist; package them for the compliance officer.
*Boundary: `packages/analytics` + `apps/api` export endpoints.*
- ✅ **Evidence exports** — `GET /v1/compliance/evidence`: access control (human +
  AI permissions and governance rules), approvals with deciders, eval reports,
  config-change history, machine-access inventory, and the full audit trail —
  structurally free of secrets.
- **Retention policies** per data class (conversations, memories, documents).
- ✅ **PII redaction** at the memory boundary: emails, Luhn-valid cards, SSNs, and
  unambiguous phone formats become typed placeholders before storage (episodic
  memories and the memory.save tool).
- **Human-accountability chain** — every consequential AI action names the human
  who authorized the rule that permitted it.

### 3.5 Change Management — ship employee changes safely 🟡 (versioning shipped)
*Boundary: `packages/core` (versioning), `apps/api`.*
- ✅ **Versioned employee configs** — every change snapshots the prior config
  (`GET /employees/:id/versions`); **rollback** restores it through the same eval
  gate as any edit. ⬜ Diff view in the console.
- ⬜ **Canary rollout** — route a fraction of an employee's traffic to the new
  version; promote on eval + KPI parity.

### 3.6 Interoperability — fit the stack, don't fight it 🟡 (MCP shipped)
*Boundary: `packages/integrations`.*
- ✅ **MCP support** — connect any Model Context Protocol tool server
  (`POST /v1/integrations`, Streamable HTTP client, session-aware, JSON+SSE
  framings); discovered tools become assignable employee tools
  (`mcp.<server>.<tool>`) executed through the agent loop. Disconnect removes
  them on the next request.
- ⬜ **SCIM provisioning + SSO** — enterprise IT manages human users the way they
  already manage everything else.
- ✅ **Outbound event bus** — domain events (task.created, employee.hired,
  approval.decided, workflow.run.*) deliver to registered webhooks with
  HMAC-SHA256 signatures; wildcard or filtered subscriptions; failures audited,
  never breaking the emitting operation. ⬜ queued retrying dispatcher (worker).

### 3.7 Business Continuity ⬜ → M5
*Boundary: `packages/agents`.*
- **Provider failover** — automatic retry on a secondary provider on outage, with
  the hermetic local provider as the always-available floor.
- **Degraded mode** — read-only workforce visibility even when model providers or
  connectors are down.

---

## 4. Milestone sequencing

- **M0 — Foundation** ✅ monorepo, core domain, provider abstraction, store + seed, API, web console.
- **M1 — Workflow engine** ✅ executable workflows with approvals, connectors, and the runs UI.
- **M2 — Knowledge, memory & AI QA** ✅ ingestion → chunking → embeddings → semantic
  search → citations in chat; memory scoring/pruning + timeline; golden-task eval
  suites and the regression gate (§3.2). *Deferred from M2 → M3:* probation mode +
  performance reviews (§3.1), pgvector-backed storage (rides with the Postgres store).
- **M3a — Trust & governance** ✅ probation lifecycle (hire → training → evals →
  activate), per-employee daily token budgets (hard 429), individual + org-wide kill
  switch, config versioning with gate-checked rollback (§3.1, §3.5).
- **M3b — Real persistence** ✅ Postgres store behind the same interface
  (ADR-0009): JSONB document tables, postgres.js driver selected by DATABASE_URL,
  schema ensured + idempotent seed on first boot, full API test suite runs on real
  SQL via PGlite in CI. Setting DATABASE_URL on Vercel turns on durability.
- **M3c — API keys & performance reviews** ✅ scoped API keys (SHA-256 stored,
  plaintext once, Bearer auth with exact scopes, no privilege escalation, revocation)
  and KPI-backed performance reviews (§3.1). *Remaining for M3d:* sessions + SSO
  auth, invitation flow, canary rollout, cost-per-outcome FinOps (§3.3).
- **M4a — Executable employee tools** ✅ the agent loop: chat → tool call →
  permission-gated execution → result grounded into the reply (visible as chips in
  the console). Built-ins: task.create, kb.search, memory.save — real effects,
  audited. The hermetic local provider decides via declared per-tool triggers;
  cloud models decide natively from the same neutral definitions.
- **M4b — MCP tool support** ✅ dependency-free MCP client (Streamable HTTP,
  session-aware, JSON+SSE response framings); integrations API connects servers
  and discovers tools; MCP tools compose into the per-request registry and run
  through the agent loop under employee permissions.
- **M4c — Native cloud tool-calling + event bus** ✅ Anthropic tool_use, OpenAI
  tool_calls, and Gemini functionCall wire formats (streaming parse + tool-history
  mapping, fixture-tested); HMAC-signed outbound webhooks for domain events.
- **M4d — Scheduler, worker & credentialed connectors** ✅ 5-field cron matcher
  in core; idempotent scheduler tick (POST /v1/worker/tick + `apps/worker` loop)
  starting due scheduled workflows exactly once per minute; credentialed REST and
  Slack connectors — connecting an integration makes workflow integration nodes
  deliver for real (headers redacted from reads), disconnecting reverts to the
  hermetic default. ⬜ OAuth flows, SCIM, queued retrying webhook dispatcher.
- **M5a — Observability & compliance core** ✅ per-employee AI cost (list-price
  estimates from recorded provider/model/tokens) and latency analytics
  (`GET /v1/analytics` + dashboard); compliance evidence pack (§3.4); PII
  redaction at the memory boundary (§3.4).
- **M5b — Hardening** → rate limiting, prompt-injection defenses, retention
  policies, backups; provider failover + degraded mode (§3.7); tracing exporters.
- **M6 — Commercial surface** → billing, marketplace, `apps/admin`, `apps/mobile`;
  sandbox trials for marketplace employees (§3.1).

Each milestone is one or more PRs into `main`; this map is updated as each lands.

---

## 5. Working agreements

- Every commit compiles (`pnpm typecheck`) and passes tests (`pnpm test`).
- No placeholders, no TODOs, no faked functionality — a capability is ✅ only when it
  runs end-to-end and is covered by a test.
- New cross-cutting decisions get an ADR in `docs/adr/`.
- New org-scoped tables carry `organization_id` + an RLS policy (ADR-0004).
- The platform stays runnable and testable fully offline (ADR-0002, ADR-0005).
