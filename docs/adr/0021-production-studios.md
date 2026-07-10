# ADR-0021: Production Studios — the orchestration layer

- Status: Accepted
- Date: 2026-07-10

## Context

The directive: WankongOS should orchestrate what a business PRODUCES —
documents, designs, video, audio, websites, code, publishing, print, CAD,
finance, legal, knowledge, research, brand, conversion, asset management —
without baking every capability into one app or faking what isn't wired.

## Decision

**A catalog with honest tiers.** `STUDIOS` in core defines sixteen studios,
each `builtin` (works today, server-side, zero external services) or
`connector` (activates only when a matching integration exists —
`GET /v1/studios` derives `active` from the Integration Hub, never asserts
it). Video/Audio/Publishing/Research/Engineering are connector-tier by
design; Document/Design/CAD/Website/Financial/Legal/Conversion/Knowledge/
Brand/Assets ship working.

**Assets are records.** Every output is a versioned, tagged, org-scoped
`Asset` (inline content for text formats) with employee/user attribution,
audit events, and pulse phrasing. `PATCH` bumps `version`.

**Deterministic generators.** `POST /v1/studios/:id/generate` (and the
`studio.produce` employee tool) runs server-side generators: invoices with
computed totals, SOPs/minutes, NDA drafts explicitly marked for professional
review, AI spend reports from recorded usage, brand-driven SVG (cards,
banners, monograms), parametric SVG floor plans, landing-page HTML, and
markdown/CSV conversions. Requesting a connector-tier kind 422s with a
pointer to the Integration Hub.

**One brand, everywhere.** The org's `BrandKit` (colors, font, tone,
tagline, logo asset) feeds both the design generators and — via the grounded
prompt context — every employee's system prompt.

## Consequences

- The platform can claim exactly what it does: sixteen studios cataloged,
  ten productive today, six honestly gated on connectors.
- Rich formats (DOCX/PDF/PPTX, raster images) need libraries or services;
  they attach behind the same generate seam without API changes.
- Inline asset content caps at 500 KB; binary/object storage is the next
  step when a connector-tier studio lands.
