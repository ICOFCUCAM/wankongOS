# ADR-0030: Platform engines — shared infrastructure over smarter individuals

## Status
Accepted (2026-07)

## Context
The scaling review argued: instead of making individual AI employees
smarter one by one, invest in shared enterprise infrastructure that raises
the standard of everything they produce. Ten engines were proposed. This
ADR records how each landed and the honesty boundaries kept.

## Decision — one pipeline, ten engines

**Enterprise Composition Engine** (`packages/core/composition.ts`,
`apps/api/composition.ts`, `POST /v1/compose`, `doc.compose` tool).
Every output first becomes a STRUCTURED representation — semantic sections
(heading/paragraph/list/table/kv/note/slide) with metadata (docType,
draft/internal/confidential/approved status, author employee + department,
reviewer, language) — then passes through the shared engines and renders
to markdown, branded PDF, or HTML deck as a stored, verifiable asset.
Improving one engine improves every department at once.

**Document Intelligence.** The branded PDF writer carries letterhead
(brand-color monogram, company name, tagline), document number (= asset
id, so every paper traces to a record), date, author byline, reviewer,
page numbers, legal footer, status watermark, a COMPANY RECORD stamp
(never a government seal), and a footer verification code —
`GET /v1/verify/:code` proves a printed paper against stored records (the
honest precursor to QR rendering; raster logos and DOCX/XLSX/PPTX arrive
with object storage / OOXML renderers).

**Evidence Engine.** Paragraphs cite `EvidenceRef`s (task, asset,
journal entry, conversation, approval, document, audit). Dangling refs
block composition; claim-bearing doc types (brief, contract draft, filing
paper) must cite at least one record; `GET /v1/evidence/resolve` turns any
citation into a title + console link.

**Policy Engine + Company Style Engine + Company DNA.** One record per
org (`/v1/dna`, ❖ in the sidebar): mission, vision, values, style
register (formal/friendly/government/academic/plain), risk appetite,
decision rules, approval limits, preferred suppliers, industry standards,
and the central, versioned policy store. Every employee's grounded prompt
carries the DNA section; the `policy.lookup` tool queries policies instead
of trusting prompt text; editing a policy bumps its version for everyone.

**Quality Engine** (`runQualityChecks`). One final deterministic reviewer:
grammar hygiene (placeholders block), brand-name misspellings, formatting
(heading order, table shape), policy rules from the DNA enforced
literally, evidence requirements, compliance (safeguard present; nothing
may claim a filing was submitted), accessibility floors. Transparent
rules, not a model's opinion — every block is reproducible.

**Presentation Engine** (builtin studio, `format: "deck"`). Branded HTML
decks: auto executive-summary slide, SVG charts in brand colors, speaker
notes, a hard six-bullet readability rule (overflow moves to notes,
disclosed on the slide).

**Accounting Engine, two layers** (`GET /v1/accounting/packages`).
Layer 1: the universal ledger — never changes per country. Layer 2:
versioned jurisdiction packages (18 today) with their structured exports
(SAF-T, FEC) and each national e-filing portal named and honestly
connector-gated. Country #201 is a package, not an engine change.

**Workflow Intelligence Engine** (`GET /v1/workflows/insights`). Learns
from stored run history: success rates, per-node timing/failures, approval
outcomes; recommends always-approved gates for review, names bottlenecks
and failure-prone nodes. Recommendations are suggestions for the builder,
never auto-applied; with thin history it stays quiet.

**Executive Intelligence Engine** (`GET /v1/intelligence/executive`).
The CEO's advisor: top risks this week, overloaded departments, what to
hire next — every item a disclosed rule over records with a link to act;
the BI analyst's narrative may only re-order and explain derived items.

## Consequences
- Quality is now centralized: a better letterhead, a stricter quality
  rule, or a new policy upgrades Accounting, Legal, HR, Sales, and every
  other department in the same commit.
- Everything remains explainable: blocks name rules, briefs carry
  evidence, papers carry verification codes, recommendations carry
  formulas.
- Known limits, stated: no QR rendering, no OOXML formats, no raster
  logos yet; heuristic rubric fallback is labelled; e-filing portals stay
  connector-gated.
