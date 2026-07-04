# ADR-0004: Multi-tenancy and data isolation

- Status: Accepted
- Date: 2026-07-04

## Context

One deployment serves many organizations. Cross-tenant data leakage is the single
most serious failure mode for a B2B platform (SOC 2 / GDPR posture).

## Decision

Every business entity carries an `organizationId`. The API is single-tenant per
resolved context and scopes every read/write to it (`findScoped` returns 404 for
out-of-org ids rather than leaking existence). The production schema
(`packages/store/schema.sql`) enforces isolation at the database with Row-Level
Security keyed on a request-scoped `app.current_org` setting, so isolation does not
depend on application code being perfect.

## Consequences

- Defense in depth: application scoping *and* database RLS.
- Out-of-org access is indistinguishable from "not found".
- Every new table must add its `organization_id` column and RLS policy — enforced
  by review and schema convention.
