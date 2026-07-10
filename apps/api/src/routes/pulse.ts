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
  "employee.collaborate": "consulted a teammate",
  "employee.clone": "was cloned from a proven teammate",
  "employee.pause": "was paused",
  "employee.resume": "was resumed",
  "employee.activate": "passed evals and was activated",
  "employee.offboard": "was offboarded",
  "employee.activation.blocked_by_evals": "failed activation evals",
  "evals.run": "ran their eval suite",
  "review.generate": "received a performance review",
  "memory.prune": "had stale memories pruned",
  "tool.task.create": "created a task for a teammate",
  "workflow.approval.requested": "requested an approval inside a workflow",
  "workflow.run.start": "started a workflow run",
  "workflow.run.scheduled": "had a workflow run scheduled",
  "document.injection_flagged": "flagged a suspicious document",
  "studio.generate": "produced a new asset in a studio",
  "asset.create": "stored a new asset",
  "accounting.entry.post": "posted a journal entry",
  "accounting.period.close": "closed an accounting period",
  "accounting.period.reopen": "reopened an accounting period (with reason)",
  "accounting.department.hire": "staffed the accounting department",
  "accounting.company.create": "registered a new group company",
  "accounting.bank.import": "imported a bank feed",
  "accounting.bank.reconcile": "ran bank reconciliation",
  "accounting.fx.record": "recorded an exchange rate",
  "accounting.payroll.run": "ran payroll for the period",
  "accounting.asset.register": "registered a fixed asset",
  "accounting.depreciation.run": "ran depreciation for the period",
  "accounting.invoice.ingest": "ingested an invoice into the books",
  "recruiting.interview.schedule": "scheduled a candidate interview",
  "marketplace.hire": "was hired from a marketplace template",
  "marketplace.install_pack": "installed an entire department from the marketplace",
  "meeting.executive": "held an executive meeting — minutes filed",
  "recruiting.interview.complete": "completed an interview and filed the report",
  "autonomy.task.complete": "autonomously completed an assigned task",
  "studio.publish": "published a post through a connected channel",
  "studio.engineering.issue": "filed a GitHub issue",
};

/** Audit actions whose story is already told by the task items themselves. */
const AUDIT_SKIP = new Set(["tool.task.progress", "tool.task.complete", "autonomy.task.checkpoint"]);

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
    ctx.store.employees.listByOrg(orgId),
    ctx.store.tasks.listByOrg(orgId),
    ctx.store.approvals.listByOrg(orgId),
    ctx.store.auditEvents.listByOrg(orgId),
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
    if (AUDIT_SKIP.has(e.action)) continue;
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
