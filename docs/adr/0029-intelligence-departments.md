# ADR-0029: BI and Strategy answer from an evidence pack, not from vibes

## Status
Accepted (2026-07)

## Context
The competitive review identified two departments nobody ships: Business
Intelligence ("why are sales down?" answered across CRM/accounting/support)
and Strategy ("how do we reach $10M ARR?" answered as a cross-functional
plan). The dangerous way to build these is to let a model freestyle numbers.
Our design law forbids that: everything derives from stored records, and
estimates carry disclosed formulas.

## Decision
Both departments stand on a DETERMINISTIC evidence pack
(`GET /v1/intelligence/metrics`, `buildEvidencePack`): revenue and expenses
per calendar month read straight off the ledger (credits on 4xxx, debits on
5xxx/6xxx), per-department task throughput with a 14-day-vs-prior-14-day
delta, company health with its inputs, pending approvals, and AI spend —
every derivation named in a `formulas` list, and a `limits` sentence that
states what the records do NOT cover (no CRM, web analytics, or support-desk
data without connectors).

The AI narrative sits on top, not beside: `POST /v1/intelligence/ask` runs
the BI department's lead with the evidence pack fenced into the input and
instructions to cite its numbers, name formulas, and declare gaps instead of
guessing. `POST /v1/intelligence/plan` does the same for the Strategy
Office, plus a scenario baseline whose own formula says "an illustration
from one data point, not a forecast" — plans are staged recommendations
pending approval, never commitments.

Both are honestly gated (422 with a pointer to the marketplace until the
department is staffed and activated), both file their output as a markdown
asset (`bi_brief` / `strategy_plan`) with the full evidence pack embedded —
so every answer becomes part of company memory and is findable in search —
and both are audited and appear in the pulse.

The departments themselves ship as marketplace packs
(`business-intelligence`, `strategy`), three roles each with
benchmark-enforced guardrail evals like every other pack.

## Consequences
- An executive answer can always be checked: the brief carries the exact
  numbers it was allowed to use.
- Answer quality is bounded by connected data — by design. Adding a CRM
  connector widens the evidence pack; nothing else changes.
- The run-rate scenario is deliberately naive (month × 12) and says so;
  richer models belong in the evidence pack as more record types land.
