# ADR-0015: Cost/latency observability, compliance evidence, PII redaction

- Status: Accepted
- Date: 2026-07-10

## Context

Leadership needs CFO-legible AI spend and speed per employee (§3.3 groundwork);
compliance officers need evidence they can hand to an auditor (§3.4); and
memories must not hoard customer PII (§3.4).

## Decision

**Observability at the message.** Every assistant turn records provider, model,
both token counts, and latency — the assistant message is the single accounting
record for its exchange, so cost is priced at the correct model's rates with no
double counting. A small list-price table in core (`estimateCostUsd`, local = 0,
unknown models fall back to provider defaults) turns tokens into **labelled
estimates**. `GET /v1/analytics` aggregates per employee (requests, tokens,
est. cost, avg latency) plus org totals; the dashboard shows cost and latency.

**Compliance evidence pack.** `GET /v1/compliance/evidence` (audit:read)
assembles, from stored records only: access control (human roles + each AI
employee's permissions/approval/escalation rules/budgets), human oversight
(approvals with deciders), quality (eval reports incl. gate runs), change
management (config version history), machine access inventory (key prefixes and
scopes — never hashes), and the full audit trail. Secrets are structurally
absent from the pack.

**PII redaction at the memory boundary.** `redactPii` in core replaces emails,
Luhn-valid card numbers, SSNs, and unambiguously-formatted phone numbers with
typed placeholders (`[redacted:email]`). Applied where memories are written
(episodic capture and the memory.save tool). Deliberately conservative — space
-separated digit runs are NOT matched — because false positives corrupt
memories; conversations themselves are retained verbatim (retention policies
are M5b).

## Consequences

- Spend and latency are attributable per employee with zero extra
  infrastructure; estimates are honest about being estimates.
- An auditor gets one JSON document answering "who can do what, who approved
  what, how is quality proven, what changed" — generated on demand.
- Memories are safe-by-default against the most common PII classes; the
  pattern set is extendable and each redaction is typed for auditability.
