import { Hono } from "hono";
import type { Env } from "../context.js";
import { authorize } from "../http.js";

export const dashboardRoutes = new Hono<Env>();

/**
 * CEO dashboard: a live snapshot of the AI workforce computed from the store.
 * Every number is derived from real records — no hard-coded figures.
 */
dashboardRoutes.get("/dashboard", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const orgId = ctx.organizationId;

  const [employees, departments, tasks, approvals, goals, messages, conversations, workflows, runs] =
    await Promise.all([
      ctx.store.employees.list((e) => e.organizationId === orgId),
      ctx.store.departmentsByOrg(orgId),
      ctx.store.tasks.list((t) => t.organizationId === orgId),
      ctx.store.approvals.list((a) => a.organizationId === orgId),
      ctx.store.goals.list((g) => g.organizationId === orgId),
      ctx.store.messages.list(),
      ctx.store.conversations.list((c2) => c2.organizationId === orgId),
      ctx.store.workflows.list((w) => w.organizationId === orgId),
      ctx.store.workflowRuns.list((r) => r.organizationId === orgId),
    ]);

  const activeEmployees = employees.filter((e) => e.status === "active").length;
  const tasksByStatus = countBy(tasks, (t) => t.status);
  const completedTasks = tasksByStatus.done ?? 0;
  const openTasks = tasks.length - completedTasks - (tasksByStatus.cancelled ?? 0);
  const pendingApprovals = approvals.filter((a) => a.status === "pending").length;

  const tokensOut = messages.reduce((n, m) => n + (m.tokensOut ?? 0), 0);
  const tokensIn = messages.reduce((n, m) => n + (m.tokensIn ?? 0), 0);

  // Estimated hours saved: a transparent heuristic combining completed work and
  // AI interactions. Labelled as an estimate; the formula lives with the number.
  const estimatedHoursSaved =
    Math.round((completedTasks * 2.5 + conversations.length * 0.5) * 10) / 10;

  return c.json({
    organizationId: orgId,
    workforce: {
      employees: employees.length,
      activeEmployees,
      departments: departments.length,
      byStatus: countBy(employees, (e) => e.status),
    },
    tasks: {
      total: tasks.length,
      open: openTasks,
      completed: completedTasks,
      byStatus: tasksByStatus,
    },
    approvals: { pending: pendingApprovals },
    goals: {
      total: goals.length,
      byStatus: countBy(goals, (g) => g.status),
      averageProgress:
        goals.length === 0
          ? 0
          : Math.round((goals.reduce((n, g) => n + g.progress, 0) / goals.length) * 100) / 100,
    },
    ai: {
      conversations: conversations.length,
      tokensIn,
      tokensOut,
      utilization: employees.length === 0 ? 0 : Math.round((activeEmployees / employees.length) * 100) / 100,
    },
    workflows: {
      defined: workflows.length,
      runs: runs.length,
      byStatus: countBy(runs, (r) => r.status),
    },
    automation: {
      estimatedHoursSaved,
      formula: "completedTasks * 2.5h + conversations * 0.5h",
    },
  });
});

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
