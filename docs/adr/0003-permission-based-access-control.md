# ADR-0003: Permission-based access control

- Status: Accepted
- Date: 2026-07-04

## Context

Both human users and AI employees act on the system, and enterprises require
least-privilege, auditable access. Checking coarse roles at call sites (`if admin`)
scatters policy and resists change.

## Decision

Model fine-grained `Permission`s (e.g. `employee:create`, `task:approve`,
`audit:read`). A `UserRole` expands to a set of permissions in one place
(`permissionsForRole`). Every sensitive API route asserts a single permission via
`authorize()`. AI employees carry their own `permissions` array, and tool execution
is gated on it so a model can never exceed its authorization.

## Consequences

- Policy lives in one table; roles evolve without touching call sites.
- The same mechanism governs humans, employees, and API keys (which carry scopes).
- Access decisions are uniform and easy to audit.
