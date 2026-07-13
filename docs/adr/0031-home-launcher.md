# ADR-0031: A home launcher, not the dashboard, at `/`

## Status
Accepted (2026-07)

## Context
The deployed console opened directly on the "Good morning" workforce
dashboard. Landing on a dense operational screen makes the dashboard *be*
the product's front door — there was no calm entry point, no obvious "where
do I go?", and the dashboard's sidebar chrome wrapped every route including
the first impression.

## Decision
Introduce a full-bleed **home launcher** at `/` and move the dashboard to
`/dashboard`.

- All sidebar-wrapped pages move into a `(console)` route group with its own
  layout (sidebar + scroll container). Route groups don't change URLs, so
  `/accounting`, `/employees`, etc. are unchanged.
- The **root layout** now owns only `<html>/<body>` and the no-flash theme
  script. `/` (launcher) and `/login` render full-bleed without the sidebar.
- The launcher is an entry point, not a second dashboard: brand + greeting,
  one command box that runs a whole-company search (`/search`), quick-access
  tiles to every area, and a live footer (employees active, company health,
  tasks running, approvals) drawn from real records — degrading to a plain
  entry point if the API is unreachable. The sidebar brand mark links back
  here; login lands in `/dashboard`.

## Consequences
- First impression is calm and directs attention; the operational dashboard
  is one click away and unchanged.
- The background is a self-contained CSS aurora (theme-aware, honors
  `prefers-reduced-motion`) — no external image, consistent with the
  self-contained deploy.
- Nothing in the launcher is invented: every number is a stored record, and
  the whole footer is hidden when the API can't be reached.
