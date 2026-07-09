# ADR-0006: Data-driven workflow engine with injected effects

- Status: Accepted
- Date: 2026-07-09

## Context

The platform must automate multi-step business processes that route work through AI
employees, decisions, human approvals, and external systems — with retries, timeouts,
loops, and parallelism. Approvals mean a run can pause for minutes or days, so the
engine cannot assume a single in-process execution.

## Decision

Model workflows as declarative node graphs in `@wankong/core` (routing lives inside
each node, so a definition is self-contained and serializable). Implement a pure
interpreter in `@wankong/workflow` that mutates and returns run state and delegates
every side effect — employee resolution, approval creation, notifications, connector
calls, persistence — to injected hooks. Approvals set the run to `paused` with a
`pendingApprovalId`; `resume()` continues from the recorded node after a decision.
Conditions are a small, safe, `eval`-free expression language over the run context.

## Consequences

- The same engine runs in tests (hermetic), in the API (synchronous until pause), and
  later in `apps/worker` (durable, queue-backed) without changes.
- Pausing is first-class, so long-lived human-in-the-loop processes are natural.
- A step ceiling bounds loops; parallel branches disallow nested approvals/parallels
  (documented) to keep join semantics simple.
- Persisting run state is the caller's job — the engine stays free of storage concerns.
