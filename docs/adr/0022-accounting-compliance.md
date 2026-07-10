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
period status). Multi-company is now in: each legal
entity holds its own ledger under its own engine, and consolidation reports
per-entity and per-currency results while explicitly declining to apply FX
translation or intercompany eliminations until those are real.

Bank feeds (same day): imported statements are records; reconciliation is
deterministic (exact reference, or exact cash movement within five days);
whatever doesn't match returns as drafted entries for human review — the
system never posts to the ledger from a bank line on its own.

FX (same day): exchange rates are recorded records (with source and as-of
date); `consolidated?presentation=CCY` translates entity totals using the
latest recorded rate (direct or inverse), excludes and lists entities with
no recorded rate, and discloses the method's limits (closing-rate on
totals; not a full IAS 21 / ASC 830 translation).

Payroll (same day): each engine carries its employer-contribution rule as
versioned data (arbeidsgiveravgift, arbetsgivaravgifter, employer NI, FICA,
SV-Anteil, CPP+EI) at the STANDARD rate with simplifications disclosed in
every response (zones, thresholds, caps not modeled). A run posts exactly
one balanced journal entry, stores a payroll-register asset, refuses closed
periods and duplicate runs, and follows the company's own engine.

Registry expansion (same day): 18 engines now ship — DK, FI, FR, NL, BE,
IE, AU, NZ, SG, JP, KR, ZA join the original six. Every engine carries a
rulesVersion, a payroll rule with disclosed approximations, and its filing
calendar; the registry test pins the full checklist. Adding jurisdiction
#19 remains a data record plus tests.

Eliminations / assets / invoices (same day): consolidation now eliminates
entries explicitly flagged `intercompanyWith` (revenue and asset legs) and
states that unflagged intercompany activity is not detected. A fixed-asset
register drives idempotent straight-line depreciation runs (one adjustment
entry per period, closed periods respected) — clearing the depreciation
anomaly the honest way. Invoice intake posts jurisdiction-checked entries
from structured data (sale → AR/revenue/output VAT; purchase → expense/
input VAT/AP) with duplicate guards and standard-rate warnings; raw
documents are refused with a pointer to a vision connector, never
pretend-parsed.
