# ADR-0018: The living console — derived activity, never simulated

- Status: Accepted
- Date: 2026-07-10

## Context

The employee console looked like a static directory: identical cards, no sense
of who was doing what, no company-level rollups, no feed of what happened.
Making it "feel alive" the easy way — animated fake activity, randomized
status — would betray the product's core promise: these are real AI employees
doing real work, and the console is how a business supervises them.

## Decision

**Derived, never stored.** An employee's activity status is a pure function
`deriveActivityStatus(employee, {tasks, pendingApprovals})` in `@wankong/core`
with precedence blocked > waiting > working > idle; paused/offboarded map to
offline and training to learning. Confidence is the average eval pass ratio.
Neither value is persisted, so the console can never drift from the records —
delete a task and the status changes with it.

**One summaries feed.** `GET /v1/employees/summaries` computes, per employee:
activity, in-progress work, current task + progress, today's completions,
pending approvals, usage metrics (from recorded messages via a shared
`perEmployeeUsage` aggregator, also used by `/v1/analytics`), confidence, and
personality. One call renders the entire workforce view.

**One status vocabulary.** The web tier maps each activity to a fixed color +
label + pulse (`lib/activity.ts`): working green, waiting amber, blocked red,
learning blue, idle gray, offline dim. Cards, org chart nodes, department
tiles, and rollups all consume the same map.

**Pulse over polling logs.** `GET /v1/pulse` merges tasks, approvals, and the
audit trail into human sentences ("Ava was hired", "Noah completed …"), newest
first. It is a read-model over stored records; nothing is written to produce
it.

**Liveness by re-derivation.** Console pages mount an `AutoRefresh` primitive
that re-renders server components every 15s while the tab is visible (paused
in background tabs). No websockets yet — with serverless deployment and an
embedded API, periodic re-derivation is the honest, simple implementation;
event push can replace the timer later without changing any data contract.

**Hierarchy = attention.** The dashboard leads with what needs a human
(pending approvals, blocked employees) and hides that banner on calm days.

## Consequences

- A demo org with no cloud keys still shows a truthful console: seeded tasks
  produce real working/blocked states; usage appears only after real chats.
- Everything on a card is explainable by pointing at a stored record — the
  compliance stance extends to the UI.
- Cost: summaries recompute per request. Fine at current scale; when it isn't,
  the derivation functions are pure and can be cached or materialized without
  API changes.
