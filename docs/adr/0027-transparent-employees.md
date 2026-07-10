# ADR-0027: Transparent employees — timeline, evidence, and the meeting

- Status: Accepted
- Date: 2026-07-10

## Context

The dashboard is frozen (polish only). The roadmap shifts to what makes an
AI employee trustworthy at work: a dedicated office, an evidence-backed
memory of what they did, and the ability to explain themselves.

## Decision

**The work timeline is evidence.** `GET /employees/:id/timeline` assembles
completions (with results), individual long-job checkpoint steps, approvals
with outcomes, delegations, conversations, and produced assets — every item
carrying the id of the record that proves it, grouped by day in the office
view.

**Explanations come from records.** The same evidence enters the employee's
grounded chat context as a timestamped activity log with an explicit
instruction to cite timestamps when explaining decisions. "Why did you move
the meeting?" is answered from the log, not confabulated — and the quality
of the citation scales with the model behind the employee.

**The office.** The workspace opens with Right now (task, progress, the
checkpoint step as the current thought, next up), Waiting on (approvals),
Connected (tools + live integrations), then the timeline, mission, evals,
memory, and chat. This page — not the dashboard — is where users work.

**The executive meeting.** Each staffed department's lead generates a
concise update from their own activity log; unstaffed departments are
honestly absent; minutes file themselves as assets. The demo writes itself
because the records are real.

## Consequences

- Explainability is a data guarantee (the log is in context), not a model
  guarantee (the local provider cites weakly; cloud models cite well).
- Timeline assembly is per-request over org-indexed queries; materialize if
  it ever gets hot.
- Next on this track: cross-employee collaboration threads (delegations
  already appear; conversations between employees are the missing hop) and
  richer marketplace department packs.
