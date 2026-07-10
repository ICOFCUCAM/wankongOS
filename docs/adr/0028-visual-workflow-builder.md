# ADR-0028: The visual workflow builder edits the runnable definition

## Status
Accepted (2026-07)

## Context
Workflow definitions were API-only: the console could show and run them but
not create or change them. Every commercial competitor ships a builder; ours
had been deferred because most builders introduce an intermediate "canvas
format" that must be compiled into the executable definition — a translation
layer where honesty goes to die (the picture and the program drift apart).

## Decision
No intermediate format. The builder (`/workflows/new`, `/workflows/:id/edit`)
edits the exact `Workflow` object the engine executes — nodes, routing fields,
trigger and all — and the canvas is a projection of it: node positions are
derived by BFS depth from the entry node, and every edge drawn comes from the
node's real routing fields via `nodeTargets()`.

Validation is shared, not duplicated. `validateWorkflowGraph()` lives in
`@wankong/core` and is called by both the builder (live problems panel) and
the API on save (`POST /v1/workflows`, `PUT /v1/workflows/:id` → 422 with the
problem list). It catches what the zod schema cannot: dangling edges,
duplicate ids, a missing entry, no reachable end node, unreachable nodes. The
API adds one tenancy check the client mirrors best-effort: employee nodes
must reference employees of the calling organization.

Deleting a node retargets everything that routed to it onto an end node, so
the graph stays runnable instead of dangling. Saving while runs are paused is
allowed and disclosed in the UI: a resumed run continues against the updated
definition (the engine reloads the workflow on resume), so node ids should
stay stable while runs are in flight.

## Consequences
- What you see is what runs — a saved workflow needs no export/compile step,
  and the detail page's definition list, the builder, and the engine can
  never disagree about the graph.
- The builder is dependency-free (no diagramming library): auto-layout plus
  SVG edges keeps the bundle small at the cost of manual node positioning —
  drag-to-reposition can be added later without touching the data model.
- `workflow:manage` gates create/update; every save is audited
  (`workflow.create` / `workflow.update`) and appears in the company pulse.
