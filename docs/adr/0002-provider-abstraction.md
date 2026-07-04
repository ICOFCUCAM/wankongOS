# ADR-0002: Provider-agnostic AI runtime

- Status: Accepted
- Date: 2026-07-04

## Context

The product must never lock into one model vendor, and it must be demoable and
testable without any API keys or network.

## Decision

Define a single `AIProvider` streaming interface in `@wankong/agents`. Implement it
four ways: Anthropic, OpenAI, and Google — all via `fetch` with no SDK dependency —
plus a hermetic `local` provider that composes grounded, role-aware replies offline.
A `ProviderRegistry` resolves the provider per employee (or the org default) and
always falls back to `local`. No app or route ever imports a vendor SDK.

## Consequences

- Switching or adding providers is a registry change, not a refactor.
- CI and local dev run with zero credentials; the `local` provider also exercises
  all streaming/usage-accounting code paths.
- Vendor-specific features (native tool calling, caching) must be surfaced through
  the shared interface rather than leaking to callers — a deliberate constraint.
