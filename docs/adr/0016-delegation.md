# ADR-0016: Employee-to-employee delegation (AI collaboration)

- Status: Accepted
- Date: 2026-07-10

## Context

The vision's collaboration chain (Sales Director → Research Analyst → …) needs
employees to hand work to colleagues — with every interaction traceable and
auditable, and without runaway agent-to-agent recursion.

## Decision

A built-in `delegate` tool (requires `task:assign`): the model names a
colleague and a request; resolution matches the colleague's name or title in
the arguments (longest match wins, self excluded). Governance carries through —
paused/training colleagues refuse (kill switch and probation apply to peers,
not just humans), and permission denial is a failed tool result the delegator
explains.

**One hop deep by construction.** The delegatee runs with its own grounded
context (knowledge, memories) but WITHOUT tools, so a delegation can never
chain into further delegations or side effects. Depth-limited chains, if ever
wanted, must be an explicit design change — not an emergent behaviour.

**Three trace records per delegation:** a real conversation between the two
employees (visible in transcripts and analytics), a completed task on the
board (assignee = delegatee, createdBy = delegator, label `delegation`, result
attached), and an `employee.delegate` audit entry linking both.

## Consequences

- "Ask the Research Analyst to profile BigCo" genuinely runs the analyst and
  returns her attributed answer inside the director's reply.
- The delegation shows up everywhere an auditor would look: tasks, transcripts,
  audit trail, token/cost analytics (the delegatee's tokens are recorded).
- The no-tools rule means a delegatee cannot create tasks or reach MCP servers
  on someone else's behalf — a deliberate least-privilege trade-off.
