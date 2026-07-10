import { Hono } from "hono";
import type { Assignee } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize } from "../http.js";

export interface PulseItem {
  at: string;
  kind: "task" | "approval" | "audit";
  text: string;
  /** Employee to link to, when the item is about one. */
  employeeId?: string;
}

/** Human phrasing for known audit actions; anything unknown falls back to the raw action. */
const AUDIT_PHRASES: Record<string, string> = {
  "employee.create": "was hired",
  "employee.update": "had their configuration updated",
  "employee.update.blocked_by_evals": "had a config change blocked by failing evals",
  "employee.rollback": "was rolled back to an earlier configuration",
  "employee.delegate": "delegated work to a teammate",
  "employee.clone": "was cloned from a proven teammate",
  "employee.pause": "was paused",
  "employee.resume": "was resumed",
  "employee.activate": "passed evals and was activated",
  "employee.activation.blocked_by_evals": "failed activation evals",
  "evals.run": "ran their eval suite",
  "review.generate": "received a performance review",
  "memory.prune": "had stale memories pruned",
  "tool.task.create": "created a task for a teammate",
  "workflow.approval.requested": "requested an approval inside a workflow",
  "workflow.run.start": "started a workflow run",
  "workflow.run.scheduled": "had a workflow run scheduled",
  "document.injection_flagged": "flagged a suspicious document",
};

export const pulseRoutes = new Hono<Env>();

/**
 * Company pulse (Problem 10): a single reverse-chronological feed of what
 * actually happened — task completions, approval requests, and audit-trail
 * events — phrased for humans. Every line traces back to a stored record;
 * nothing is simulated.
 */
pulseRoutes.get("/pulse", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const orgId = ctx.organizationId;
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);

  const [employees, tasks, approvals, auditEvents] = await Promise.all([
    ctx.store.employees.list((e) => e.organizationId === orgId),
    ctx.store.tasks.list((t) => t.organizationId === orgId),
    ctx.store.approvals.list((a) => a.organizationId === orgId),
    ctx.store.auditEvents.list((e) => e.organizationId === orgId),
  ]);
  const nameOf = new Map(employees.map((e) => [e.id, e.name]));
  const actorName = (a: Assignee) =>
    a.kind === "employee" ? (nameOf.get(a.id) ?? "An employee") : "You";

  const items: PulseItem[] = [];

  for (const t of tasks) {
    const who = t.assignee?.kind === "employee" ? nameOf.get(t.assignee.id) : undefined;
    const employeeId = t.assignee?.kind === "employee" ? t.assignee.id : undefined;
    if (t.status === "done") {
      items.push({
        at: t.updatedAt,
        kind: "task",
        text: `${who ?? "Someone"} completed “${t.title}”`,
        employeeId,
      });
    } else if (t.status === "blocked") {
      items.push({
        at: t.updatedAt,
        kind: "task",
        text: `${who ?? "A task"} is blocked on “${t.title}”`,
        employeeId,
      });
    } else if (t.status === "in_progress" && who) {
      items.push({
        at: t.updatedAt,
        kind: "task",
        text: `${who} started working on “${t.title}”`,
        employeeId,
      });
    }
  }

  for (const a of approvals) {
    if (a.status !== "pending") continue;
    const who = actorName(a.requestedBy);
    items.push({
      at: a.createdAt,
      kind: "approval",
      text: `${who} is waiting for your approval: ${a.summary}`,
      employeeId: a.requestedBy.kind === "employee" ? a.requestedBy.id : undefined,
    });
  }

  for (const e of auditEvents) {
    const phrase = AUDIT_PHRASES[e.action];
    const subjectId =
      e.targetType === "employee" && e.targetId
        ? e.targetId
        : e.actor.kind === "employee"
          ? e.actor.id
          : undefined;
    const subject = subjectId ? (nameOf.get(subjectId) ?? "An employee") : actorName(e.actor);
    items.push({
      at: e.createdAt,
      kind: "audit",
      text: phrase ? `${subject} ${phrase}` : `${subject}: ${e.action}`,
      employeeId: subjectId,
    });
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  return c.json({ data: items.slice(0, limit) });
});
