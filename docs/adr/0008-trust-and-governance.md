# ADR-0008: Trust & governance — probation, budgets, kill switch, versioning

- Status: Accepted
- Date: 2026-07-09

## Context

Enterprises scale an AI workforce only when they can bound its autonomy: stop it
instantly, cap what it spends, trust new hires progressively, and treat config
changes like deployments. These controls must be enforced server-side (a UI toggle
is not a control) and work hermetically.

## Decision

**Probation lifecycle.** New hires default to status `training`: chat and workflow
steps refuse work with 409. Graduation is `POST /employees/:id/activate`, which runs
the employee's golden-task suite (ADR-0007) and rejects failures with 422 — an
employee earns `active` by evidence, not by a checkbox. Explicit `status` on hire is
still allowed for imports/testing.

**Budget caps.** `Employee.dailyTokenBudget` is a hard ceiling: before running,
chat sums today's tokens across the employee's conversations and refuses with 429
once the cap is reached. Spend control that fails closed, not an advisory metric.

**Kill switch.** `POST /employees/:id/pause` and org-wide `POST /workforce/pause`
(requires `org:manage`) flip employees to `paused`; chat 409s and workflow employee
steps fail visibly rather than skipping silently. `resume` restores paused → active
and deliberately leaves `training` untouched — probation exits only through evals.

**Config versioning + rollback.** Every employee mutation snapshots the prior full
config (`EmployeeVersion`, monotonically numbered, with actor and change summary).
Rollback restores a snapshot's configuration fields **through the same eval gate as
any edit** and snapshots the pre-rollback state, so history is never destroyed —
rollback is itself a change, not an undo.

## Consequences

- All four controls are enforced at the API, audited, and covered by hermetic tests.
- The lifecycle (training → evals → active ↔ paused) gives status a precise,
  enforceable meaning; UI reflects it (probation badge, activate/pause controls,
  dashboard kill switch).
- Budget accounting derives from recorded message tokens, so today it covers chat;
  workflow-step usage joins when steps record their own messages (M4 worker).
- Versions store full snapshots (simple, auditable) rather than diffs — storage
  cost accepted at this scale; the Postgres store can compact later if needed.
