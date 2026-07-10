# ADR-0022: Global Accounting & Compliance

- Status: Accepted
- Date: 2026-07-10

## Context

Finance advises; Accounting maintains the official books and produces the
legally required records. The directive: a 13-role AI department driven by
country-specific rule engines, with an explicit safeguard instead of a
"guaranteed legal papers" claim.

## Decision

**Jurisdiction engines are versioned rules packages.** `JURISDICTION_ENGINES`
ships six engines (each with a `rulesVersion`) (NO, SE, UK, US, DE, CA) — standard, currency, official filing
language, VAT/GST model (null where sub-national, e.g. US), filing calendar,
chart of accounts, and local notes — behind a registry designed for many
more. `PUT /v1/accounting/jurisdiction` swaps the engine; the same
department behaves differently because the rules changed, not the code.

**The immutable ledger is the truth.** Every financial statement is derived
from the ledger rather than stored separately. `JournalEntry` enforces double-entry balance at
the schema boundary (unbalanced posts are 400s). Trial balance, P&L, and the
balance sheet are DERIVED live from entries and satisfy the accounting
identity in tests. Nothing is stored that can drift.

**Continuous monitoring.** `detectAnomalies` continuously evaluates the
ledger using the active jurisdiction engine to detect accounting anomalies,
compliance issues, and data-quality problems: duplicate
references, jurisdiction-aware VAT mismatches (silent under engines with no
national VAT), out-of-balance ledgers, depreciation review hints.

**A department, not an agent.** One idempotent call hires all 13 roles
(Chief Accountant → Compliance Officer), each configured with the active
jurisdiction engine, defined responsibilities, controlled autonomy, and the
rule that every
number must trace to a recorded transaction.

**The safeguard is part of the contract.** `ACCOUNTING_SAFEGUARD` — items
may require review/certification by an authorized accountant where local law
requires — is embedded in every statements response and generated filing
document (VAT returns, trial balance exports via the Financial Studio).

## Consequences

- Adding a jurisdiction = adding an engine record + tests; no logic changes.
- The department prepares filing-ready documentation; it never claims to
  submit filings automatically unless an approved connector exists and
  local legal requirements are satisfied: digital
  signatures, certified accountants, and portals stay human steps.
- Multilingual filings are labeled with the official language; actual
  translation is connector-tier work.

## Addendum (same day)

Feedback-driven additions: accounting periods with controlled close/reopen
(postings into closed periods are rejected; reopening requires a recorded
reason and is audited), a department audit trail endpoint, derived cash
flow, and a one-click audit package (GL + trial balance + adjustments +
period status). Multi-company consolidation is the roadmap's next
structural step and is deliberately NOT claimed yet.
