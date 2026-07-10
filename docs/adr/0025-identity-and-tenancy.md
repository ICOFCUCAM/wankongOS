# ADR-0025: Identity and multi-tenancy

- Status: Accepted
- Date: 2026-07-10

## Context

One demo org and a role header cannot carry real customers.

## Decision

scrypt-hashed passwords on users; stateless HMAC-signed session tokens
(`wks_`, WANKONG_AUTH_SECRET, per-process fallback for demos);
`/auth/register` creates a NEW empty organization + owner (optionally
pre-staffed via the starter pack); `/auth/login` and `/auth/me` complete the
loop. The middleware resolves a session into a per-request context pinned to
the token's tenant — isolation rides on the organizationId filters every
query already applies, now pushed down to indexed SQL via
`Repository.listByOrg`. SSO/OIDC mints the same token after its own
verification — that seam is the contract.

## Consequences

- Cross-tenant reads 404; new tenants start empty (proven by tests).
- The demo-role header remains for local development only.
- Session revocation (stateless tokens) and SSO are the named next steps.
