# ADR-0019: The Workforce Command Center

- Status: Accepted
- Date: 2026-07-10

## Context

ADR-0018 made the console truthful (derived, never simulated). The next
critique was philosophical: a truthful directory is still a directory. The
page should read like the control room of an autonomous business, where every
panel answers one of three questions — *what is happening now, how is the
company performing, what can I do next?*

## Decision

**Eight presence states.** The core derivation distinguishes blocked,
needs_approval, thinking (an assistant message landed within the last two
minutes — injectable clock), working, waiting (queued but not started),
learning, idle, offline — each with its own color. A web contract test pins
the vocabulary to the core model: a new state fails CI until it has a
distinct color and label.

**One presence derivation.** `deriveOrgPresence` joins employees, tasks,
pending approvals, and recorded usage once; both `/employees/summaries` and
`/workforce/health` consume it, so no two surfaces can disagree about who is
doing what.

**Company health is a formula, not a vibe.**
`100 × (0.4·availability + 0.3·flow + 0.1·approvalLoad + 0.2·confidence)`,
inputs disclosed in the response and the formula shown on hover; the test
recomputes the score from the disclosed inputs. Department badges
(healthy / busy / attention) derive from member presence and task load.

**Cards are mini dashboards.** Presence, task in flight with real progress,
today's output / avg response / eval success / cost today, reports-to, and
hover-revealed actions (workspace, assign, pause, promote, duplicate, view
memory, analytics, offboard-with-confirmation). Offboarding never deletes:
history is compliance evidence.

**The side panel earns its space.** The static org chart moved to `/org`
(still live); its slot shows the company pulse — per-department activity
bars and the live presence queue — plus business goals with real progress.

**Liveness stays honest.** 12–15s server re-derivation while the tab is
visible; progress bars transition to new widths; the newest feed entries
ease in. Motion only ever reflects a record change.

## Consequences

- "Thinking" depends on message recency, so a busy demo feels alive and an
  idle org honestly shows idle — by design, not by animation loops.
- The health formula is now a contract; changing weights is a documented,
  test-visible decision.
- Per-request derivation cost grew (one more join); still fine at this
  scale, and `deriveOrgPresence` is the single seam to cache later.
