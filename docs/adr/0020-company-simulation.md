# ADR-0020: The company simulation (Levels 1–12)

- Status: Accepted
- Date: 2026-07-10

## Context

ADR-0019's command center answered "what is happening now?". The next
directive raised the bar: WankongOS should feel like operating a company,
not reading a dashboard — living employees, a breathing organization,
mission control, department and employee workspaces, a timeline, hiring as
onboarding, and a morning briefing.

## Decision

Twelve levels, all derived from records (ADR-0018 discipline held):

1. **Workforce** — the command center baseline.
2. **Living employees** — ETA from real due dates, last-delivered shown when
   idle, autonomy on the card. No fabricated liveliness.
3. **Company pulse** — a Today ledger (done/running/queued/blocked) plus
   *estimated* value delivered with its formula in the payload; real revenue
   deliberately absent until billing (M6).
4. **Mission control** — every department as one line: a verb derived from
   its most urgent present state, workload bar, output today.
5. **Department workspace** — /departments/:id: health pill, member cards,
   the department's task slice, summed real token budgets.
6. **Employee workspace** — opens with the mission (top goal/objective) and
   today's shipped work.
7. **Timeline** — /pulse switches to wall-clock times; feed entries ease in.
8. **Conversations** — GET /employees/:id/conversations; the workspace shows
   the working relationship, not a blank chat box.
9. **Company map** — org chart nodes unfold into in-flight titles and queued
   counts, like a file tree over the company.
10. **Analytics insights** — superlatives (most productive, most available,
    fastest) and department productivity, recomputed per view.
11. **Hiring center** — a five-step wizard whose authority switches grant
    REAL permissions, ending in a welcome screen; probation unchanged.
12. **Briefing** — GET /v1/briefing: deterministic "while you were away"
    (completions, hires, blockers, approvals, windowed spend) on the
    dashboard, hidden when the window is empty.

## Consequences

- The simulation is only as alive as the records; demo seeds exercise every
  presence state, and real usage makes it richer automatically.
- Value/revenue honesty is a stated product stance: estimates carry their
  formula; revenue waits for billing.
- New per-window queries (briefing) scan messages/tasks by timestamp; fine
  at this scale, indexable later without contract changes.
