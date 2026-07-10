# ADR-0026: Marketplace, billing, notifications, and the live floor

- Status: Accepted
- Date: 2026-07-10

## Decision (four pieces, one theme: the OS operates itself honestly)

**Marketplace.** Role templates ship with starter eval suites; "proven"
means the hire must pass its own golden tasks to activate. The benchmark
test enforces this for every template in CI — it immediately caught two
templates testing vocabulary instead of enforced guardrails.

**Billing.** Plans are data; metering derives from recorded messages;
hiring beyond plan 402s; downgrades below headcount 409; checkout is
honestly gated on a Stripe connection. Invoices are documents, not charges,
until payment rails exist.

**Notifications.** Every pending decision (autonomy approvals, hiring
decisions, workflow pauses, eval drift) lands in the owners' inbox and
mirrors to a connected Slack webhook. The inbox is the reliable floor;
channels are connectors.

**Live floor.** Domain events fan out in-process to per-org SSE streams;
the console refreshes on events with polling as the fallback. Real Slack
and GitHub connectors are live (webhook delivery, issue filing) with
secrets redacted from all reads; retention runs exempt legal records; the
full-org export doubles as backup and DSAR; drift detection names, numbers,
and notifies declines without auto-remediation; and documents leave the
system as real PDFs from a dependency-free writer.
