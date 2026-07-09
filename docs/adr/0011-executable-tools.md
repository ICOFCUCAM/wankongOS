# ADR-0011: Executable employee tools (the agent loop)

- Status: Accepted
- Date: 2026-07-09

## Context

Employees carried declarative `toolIds` but couldn't act. Real digital workers
must execute capabilities — under the same least-privilege rules as everything
else, and demonstrably (hermetically) in dev/CI.

## Decision

**Agent loop in the runtime.** `EmployeeRuntime` drives: model → `tool_call` →
`ToolRegistry.execute` under the *employee's own permissions* → result appended
as a `tool` message → model produces the final grounded reply (≤3 rounds).
Tool failures (including permission denials) become failed tool results the
model can explain — never crashes, never silent skips.

**Deterministic local tool choice.** `ToolDefinition` gains optional `triggers`
(regex sources). The hermetic local provider calls a tool iff a trigger matches
the request and passes `{ text }` arguments; each built-in maps that onto its
primary field. Cloud models ignore triggers and decide natively from the same
neutral name/description/schema — their wire formats land in M4b.

**Built-ins with real effects.** `task.create` (permission `task:create`,
audited), `kb.search` (embedding search over org knowledge), `memory.save`
(long-term memory write). Only tools in the employee's `toolIds` are offered;
the registry enforces `requires` regardless of what a model asks for.

**Surface everything.** Chat responses include executed tools; SSE emits `tool`
events; the console shows 🔧 chips (green/red) on the reply.

## Consequences

- "Ask Ava to create a task" genuinely creates the task — visible on the board,
  attributed to the employee, audit-logged.
- A model can never exceed its employee's authorization: enforcement lives in
  the registry, not in the prompt.
- Trigger-based local choice is honest about its limits (explicit, not fuzzy);
  the same tests will exercise native tool-calling when cloud wiring lands.
