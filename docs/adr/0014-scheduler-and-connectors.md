# ADR-0014: Scheduler, worker, and credentialed connectors

- Status: Accepted
- Date: 2026-07-09

## Context

Workflow definitions supported `trigger.kind = "schedule"` since M1, but nothing
fired them; and workflow integration nodes only ran hermetic stand-ins. An AI
workforce that can't act on a schedule or reach real endpoints isn't operating
a business.

## Decision

**Cron in core.** A minimal, pure 5-field cron matcher (`cronMatches`) with
lists/ranges/steps and standard dom/dow OR-semantics — the scheduler's only time
authority, unit-tested for the tricky cases.

**Idempotent tick.** `runScheduledWorkflows(ctx, now)` starts every active
scheduled workflow whose cron matches `now`, at most once per workflow per
minute — deduped on the run's own `scheduledAt` input, not wall-clock, so any
number of tick sources may overlap safely. Exposed two ways:
`POST /v1/worker/tick` (gated on `workflow:run`; point a platform cron at it —
e.g. Vercel Cron with a scoped API key) and `apps/worker`, a standalone loop
ticking every 60s for long-running hosts.

**Credentialed connectors, hermetic by default.** Connecting a `rest`
integration (base URL + headers) or `slack` integration (webhook URL) upgrades
those workflow connector kinds to real HTTP delivery — resolved per call, so
connect/disconnect changes behaviour without a restart, and with no integration
the queued (side-effect-free) default remains. Credential headers are redacted
from every read path.

## Consequences

- Scheduled workflows genuinely run themselves; a "daily digest" workflow posts
  to a real endpoint with real credentials.
- The tick's per-minute idempotency makes at-least-once cron infrastructure
  safe to use.
- Secrets currently live in the integration config (redacted on read); a real
  secrets manager (encryption at rest) is scoped for M5 hardening.
- OAuth-based connectors and SCIM remain open in §3.6.
