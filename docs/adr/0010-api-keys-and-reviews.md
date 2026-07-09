# ADR-0010: API-key authentication and performance reviews

- Status: Accepted
- Date: 2026-07-09

## Context

Machine access needs first-class credentials (the SDK/integration story), and
§3.1's trust model needs its last piece: reviews that judge an AI employee on
evidence, the way a company judges a human hire.

## Decision

**API keys.** `wk_live_<40 hex>` tokens; only the SHA-256 hash is stored, the
plaintext appears once in the creation response, and a short prefix is kept for
recognisability. Bearer authentication resolves the key (constant-time hash
comparison) and yields an actor with *exactly* the key's scopes — no role
expansion. Creation is gated on `apikey:manage` and a key can only carry scopes
its creator holds (no privilege escalation); revocation is immediate. This slots
into the existing `actorFor` seam without touching any route.

**Performance reviews.** A review is a `Report` (kind `performance_review`,
subject = employee) compiled entirely from stored records over the last 30 days:
eval pass rate, task throughput, goal progress, conversations handled, config
change count. The rating rule is explicit — failing evals ⇒ *needs attention*;
evals are the hardest evidence — and the narrative states its numbers rather
than inventing praise. Deterministic by design: a review you can audit beats a
review that flatters.

## Consequences

- External tools can automate the platform today with least-privilege
  credentials; sessions/SSO for humans remain M3d and reuse the same seam.
- A leaked keys table reveals no usable secrets (hashes only).
- Reviews create a feedback loop with AI QA: define suites → run work → the
  review surfaces quality drift before customers do.
- Demo-mode requests without a key still act as the org owner — real human
  auth replaces that fallback in M3d.
