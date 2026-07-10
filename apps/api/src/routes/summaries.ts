import { Hono } from "hono";
import { currentTask, type ActivityStatus, type Employee, type Task } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize } from "../http.js";
import { avgOf, round6 } from "../metrics.js";
import { deriveOrgPresence } from "../presence.js";

export interface EmployeeSummary {
  employeeId: string;
  name: string;
  title: string;
  departmentId: string;
  status: Employee["status"];
  activity: ActivityStatus;
  /** In-progress task titles, most recently touched first (max 3). */
  workingOn: string[];
  currentTask: { title: string; progress: number | null } | null;
  completedToday: number;
  waitingApprovals: number;
  openTasks: number;
  metrics: {
    requests: number;
    tokensIn: number;
    tokensOut: number;
    estCostUsd: number;
    avgLatencyMs: number | null;
    /** Today's slice, for the card's mini dashboard. */
    costTodayUsd: number;
    requestsToday: number;
    avgLatencyTodayMs: number | null;
  };
  /** Manager's name, when the employee reports to someone. */
  reportsTo: string | null;
  /** Eval-evidence confidence in [0,1], or null when no eval reports exist. */
  confidence: number | null;
  personality: Employee["personality"];
}

export const summaryRoutes = new Hono<Env>();

/**
 * The living console feed: one call returns every employee's derived
 * presence, what they're working on right now, today's output, pending
 * approvals, usage metrics, and eval-evidence confidence — all computed
 * from stored records (via the shared presence derivation), nothing
 * simulated.
 */
summaryRoutes.get("/employees/summaries", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const orgId = ctx.organizationId;

  const [presence, evalReports] = await Promise.all([
    deriveOrgPresence(ctx.store, orgId),
    ctx.store.evalReports.list((r) => r.organizationId === orgId),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const nameOf = new Map(presence.employees.map((e) => [e.id, e.name]));

  const data: EmployeeSummary[] = presence.employees.map((e) => {
    const p = presence.byEmployee.get(e.id)!;
    const inProgress = p.tasks
      .filter((t) => t.status === "in_progress")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const current = currentTask(p.tasks);
    const myReports = evalReports.filter((r) => r.employeeId === e.id);
    const u = p.usage;

    return {
      employeeId: e.id,
      name: e.name,
      title: e.title,
      departmentId: e.departmentId,
      status: e.status,
      activity: p.activity,
      workingOn: inProgress.slice(0, 3).map((t: Task) => t.title),
      currentTask: current
        ? { title: current.title, progress: current.progress ?? null }
        : null,
      completedToday: p.tasks.filter((t) => t.status === "done" && t.updatedAt.startsWith(today))
        .length,
      waitingApprovals: p.pendingApprovals.length,
      openTasks: p.tasks.filter((t) => !["done", "cancelled"].includes(t.status)).length,
      metrics: {
        requests: u?.requests ?? 0,
        tokensIn: u?.tokensIn ?? 0,
        tokensOut: u?.tokensOut ?? 0,
        estCostUsd: round6(u?.estCostUsd ?? 0),
        avgLatencyMs: avgOf(u?.latencies ?? []),
        costTodayUsd: round6(u?.todayCostUsd ?? 0),
        requestsToday: u?.todayRequests ?? 0,
        avgLatencyTodayMs: avgOf(u?.todayLatencies ?? []),
      },
      reportsTo: e.managerId ? (nameOf.get(e.managerId) ?? null) : null,
      confidence:
        myReports.length === 0
          ? null
          : Math.round(
              (myReports.reduce((n, r) => n + r.passedTasks / Math.max(1, r.totalTasks), 0) /
                myReports.length) *
                100,
            ) / 100,
      personality: e.personality,
    };
  });

  return c.json({ data });
});
