import { Hono } from "hono";
import type { Env } from "../context.js";
import { authorize, findScoped } from "../http.js";

export interface TimelineItem {
  at: string;
  kind: "task_done" | "task_step" | "approval" | "delegation" | "conversation" | "lifecycle" | "asset";
  text: string;
  /** Record the item traces to — the evidence pointer. */
  ref: { type: string; id: string };
}

export const timelineRoutes = new Hono<Env>();

/**
 * The employee's work timeline (ADR-0027): everything they did, as
 * evidence. Task completions with results, long-job checkpoint steps,
 * approvals requested and decided, delegations, conversations opened,
 * lifecycle events, and assets produced — each item carrying the id of
 * the record that proves it. This is what turns "why did you do X?" into
 * an answerable question.
 */
timelineRoutes.get("/employees/:id/timeline", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const orgId = ctx.organizationId;
  const limit = Math.min(Number(c.req.query("limit") ?? 60), 200);

  const [tasks, approvals, auditEvents, conversations, assets] = await Promise.all([
    ctx.store.tasks.listByOrg(orgId, (t) => t.assignee?.kind === "employee" && t.assignee.id === employee.id),
    ctx.store.approvals.listByOrg(orgId, (a) => a.requestedBy.kind === "employee" && a.requestedBy.id === employee.id),
    ctx.store.auditEvents.listByOrg(orgId, (e) => e.actor.kind === "employee" && e.actor.id === employee.id),
    ctx.store.conversations.listByOrg(orgId, (cv) => cv.employeeId === employee.id),
    ctx.store.assets.listByOrg(orgId, (a) => a.createdBy.kind === "employee" && a.createdBy.id === employee.id),
  ]);

  const items: TimelineItem[] = [];

  for (const t of tasks) {
    if (t.status === "done") {
      items.push({
        at: t.updatedAt,
        kind: "task_done",
        text: `Completed “${t.title}”${t.result ? ` — ${t.result.slice(0, 140).replace(/\s+/g, " ")}` : ""}`,
        ref: { type: "task", id: t.id },
      });
    }
    if (t.checkpoint) {
      // Each finished step is its own evidence line.
      t.checkpoint.notes.forEach((note, i) => {
        items.push({
          at: t.updatedAt,
          kind: "task_step",
          text: `Step ${i + 1}/${t.checkpoint!.steps.length} of “${t.title}”: ${note.slice(0, 140).replace(/\s+/g, " ")}`,
          ref: { type: "task", id: t.id },
        });
      });
    }
  }
  for (const a of approvals) {
    items.push({
      at: a.createdAt,
      kind: "approval",
      text: `Requested approval: ${a.summary.slice(0, 160)}${a.status !== "pending" ? ` → ${a.status}` : " (pending)"}`,
      ref: { type: "approval", id: a.id },
    });
  }
  for (const e of auditEvents) {
    if (e.action === "employee.delegate") {
      items.push({ at: e.createdAt, kind: "delegation", text: "Delegated work to a teammate", ref: { type: "audit", id: e.id } });
    } else if (e.action.startsWith("autonomy.") || e.action.startsWith("studio.") || e.action.startsWith("tool.")) {
      continue; // covered by task/asset items
    } else {
      items.push({ at: e.createdAt, kind: "lifecycle", text: e.action, ref: { type: "audit", id: e.id } });
    }
  }
  for (const cv of conversations) {
    items.push({ at: cv.createdAt, kind: "conversation", text: `Conversation: ${cv.title}`, ref: { type: "conversation", id: cv.id } });
  }
  for (const a of assets) {
    items.push({ at: a.createdAt, kind: "asset", text: `Produced ${a.kind}: “${a.title}”`, ref: { type: "asset", id: a.id } });
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  return c.json({ employeeId: employee.id, data: items.slice(0, limit) });
});
