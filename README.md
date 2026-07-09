# WankongOS

**The operating system businesses use to hire, manage, supervise, and scale AI employees.**

Not a chatbot. WankongOS models an organization the way a company actually works —
Organization → Departments → Teams → **AI Employees** → Tasks → Business Outcomes —
and gives every AI employee an identity, a role, goals, KPIs, memory, permissions,
tools, and governance rules. A business logs in and manages a digital workforce.

---

## What's in this repository

This is a **modular monorepo** with a fully working, tested vertical slice of the
platform: the domain model, a provider-agnostic AI runtime, a data layer with a
seeded demo organization, a REST API (with streaming chat), and a polished web
console. Everything compiles, runs, and is covered by tests — no placeholders.

```
packages/
  core/      Domain model: typed entities, permissions, org hierarchy, KPIs (pure, no I/O)
  agents/    Provider-agnostic AI runtime: Anthropic / OpenAI / Google + hermetic local
  store/     Data layer: async repository abstraction, in-memory impl, seeded demo org
  workflow/  Workflow engine: employee/decision/approval/integration nodes, retries, pause & resume
apps/
  api/       REST API (Hono): every object over /v1, buffered + streaming chat
  web/       Next.js console: CEO dashboard, org chart, employee profiles, live chat, tasks
docs/
  ARCHITECTURE.md, adr/   Architecture overview and decision records
```

Each package has one job and depends only downward (`apps → packages`, `agents/store → core`).
Nothing is tightly coupled: swap the model provider, swap the data store, or add an
app without touching the others.

## The demo organization

Out of the box the platform is seeded with **Acme Robotics** — a human CEO and an
**11-strong AI workforce** across ten departments, each a fully specified digital worker:

Executive Assistant · Sales Director · Customer Support Manager · Recruiter ·
Marketing Director · Accountant · Legal Assistant · Research Analyst ·
Operations Manager · Procurement Officer · Social Media Manager

Every employee has responsibilities, objectives, KPIs, tools, permissions, and
approval/escalation rules — and reports into a real management hierarchy.

## Quick start

```bash
pnpm install

# Run the test suite (38 tests, no network or keys required)
pnpm test

# Print the seeded org chart
pnpm seed:print

# Run everything — the console with the API embedded (http://localhost:3000)
pnpm web

# Optional: run the API standalone for API-first usage (http://localhost:4000)
pnpm api
```

The API is **embedded in the web app** (served at `/api`), so `pnpm web` alone is a
complete, working system — and the app deploys to Vercel as-is (import the repo,
set the project Root Directory to `apps/web`, done).

No API keys are needed: the platform ships with a **hermetic `local` AI provider**
so every employee is chattable, and the whole system is testable, entirely offline.
Add `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY` (see `.env.example`)
and pin an employee to that provider to use a hosted model instead.

**Durability**: by default data lives in a seeded in-memory store (resets on
restart — fine for demos). Set `DATABASE_URL` to any Postgres connection string
(Supabase, Neon, RDS…) and the durable **Postgres store** takes over automatically —
schema created and demo org seeded on first boot, no other changes needed. The same
store code is tested in CI on real SQL via PGlite (ADR-0009).

## API surface (v1)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET`  | `/health` | Liveness |
| `GET`  | `/v1/organization` | The organization |
| `GET`  | `/v1/org-chart` | Full reporting tree |
| `GET`  | `/v1/departments` | Departments |
| `GET`  | `/v1/employees` | List AI employees (`?departmentId=`) |
| `POST` | `/v1/employees` | Hire an AI employee *(employee:create)* |
| `GET`  | `/v1/employees/:id` | One employee |
| `PATCH`| `/v1/employees/:id` | Reconfigure *(employee:manage)* |
| `GET`  | `/v1/employees/:id/goals` | Employee goals |
| `POST` | `/v1/employees/:id/chat` | Chat (buffered) *(employee:chat)* |
| `POST` | `/v1/employees/:id/chat/stream` | Chat (SSE stream) *(employee:chat)* |
| `GET`  | `/v1/conversations/:id` | Conversation transcript |
| `GET`  | `/v1/tasks` | Tasks (`?status=`, `?assigneeId=`) |
| `POST` | `/v1/tasks` | Create a task *(task:create)* |
| `POST` | `/v1/approvals/:id/decision` | Approve/reject *(task:approve)* |
| `GET`  | `/v1/workflows` | List workflows *(workflow:read)* |
| `GET`  | `/v1/workflows/:id` | Workflow + recent runs *(workflow:read)* |
| `POST` | `/v1/workflows/:id/run` | Start a run *(workflow:run)* |
| `GET`  | `/v1/workflows/runs/:runId` | Run detail *(workflow:read)* |
| `GET`  | `/v1/knowledge-bases` | Knowledge bases + doc counts *(knowledge:read)* |
| `POST` | `/v1/documents` | Ingest/re-version a document *(knowledge:write)* |
| `POST` | `/v1/knowledge/search` | Semantic search → citations *(knowledge:read)* |
| `GET`  | `/v1/employees/:id/memories` | Salience-ranked memory timeline *(employee:read)* |
| `POST` | `/v1/memories/prune` | Prune memories per owner *(org:manage)* |
| `GET`  | `/v1/employees/:id/evals` | Golden suite + recent reports *(employee:read)* |
| `POST` | `/v1/employees/:id/evals/run` | Run the suite now *(employee:manage)* |
| `POST` | `/v1/employees/:id/pause` · `/resume` | Individual kill switch *(employee:manage)* |
| `POST` | `/v1/employees/:id/activate` | Graduate probation — must pass evals *(employee:manage)* |
| `POST` | `/v1/workforce/pause` · `/resume` | Org-wide kill switch *(org:manage)* |
| `GET`  | `/v1/employees/:id/usage` | Today's tokens vs. budget *(employee:read)* |
| `GET`  | `/v1/employees/:id/versions` | Config version history *(employee:read)* |
| `POST` | `/v1/employees/:id/rollback` | Restore a version (gate-checked) *(employee:manage)* |
| `GET`  | `/v1/dashboard` | Live CEO metrics |
| `GET`  | `/v1/audit` | Audit trail *(audit:read)* |

Authorization is permission-based. In this dev build, requests act as the org owner;
pass `x-demo-role: viewer|member|manager|admin|owner` to exercise the permission model.
The `actorFor()` seam is where a real SSO / API-key resolver drops in.

## Testing

```bash
pnpm test        # unit + integration (vitest)
pnpm typecheck   # strict TypeScript build of all packages
```

## Architecture & decisions

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the ADRs in
[`docs/adr/`](docs/adr). Production notes — the Postgres/Supabase schema with
per-tenant Row-Level Security — live in [`packages/store/schema.sql`](packages/store/schema.sql).

## Roadmap

The build is tracked in **[`docs/BUILD_MAP.md`](docs/BUILD_MAP.md)** — a living map
that ties every directive module to a package/app boundary with its current state and
milestone. Delivered so far: the foundation (M0) and the workflow engine (M1). Next:
knowledge & memory with embeddings (M2), then real persistence + auth (M3), integrations
+ background worker (M4), observability + hardening (M5), and the commercial surface (M6).
