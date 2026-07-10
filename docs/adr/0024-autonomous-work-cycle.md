# ADR-0024: The autonomous work cycle

- Status: Accepted
- Date: 2026-07-10

## Context

Employees were reactive: they worked when chatted with or when a workflow
fired. An AI workforce must work its own queue.

## Decision

`runWorkCycle` (driven by the worker loop and `/v1/worker/tick`): each idle
ACTIVE employee claims its oldest queued task and genuinely executes it —
runtime + tools + a recorded conversation — then completes it with a result.
Governance is structural, not configurable text: low-autonomy employees
request a human approval before starting (once per task; approved → they
work next cycle, rejected → the task stands down, audited); budget-exhausted
employees are skipped with the reason; paused/training employees never work.
Everything flows through the same records the console derives from.

## Consequences

- The command center now shows employees working without anyone chatting.
- Cost control is inherited (daily budgets), and every autonomous action is
  attributable (audit + conversation transcript).
- Long multi-step background jobs (hours-scale) need checkpointing — the
  next iteration of this loop, not this one.
