import { Hono } from "hono";
import { deriveActivityStatus, type ActivityStatus } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize } from "../http.js";
import { avgOf, perEmployeeUsage, round6 } from "../metrics.js";

export type DepartmentHealth = "healthy" | "busy" | "attention";

export interface DepartmentPulse {
  departmentId: string;
  name: string;
  employees: number;
  byActivity: Partial<Record<ActivityStatus, number>>;
  openTasks: number;
  completedToday: number;
  costTodayUsd: number;
  health: DepartmentHealth;
}

export interface WorkforceHealth {
  employees: number;
  activeEmployees: number;
  departments: number;
  activeTasks: number;
  completedToday: number;
  runningWorkflows: number;
  pendingApprovals: number;
  avgResponseMs: number | null;
  costTodayUsd: number;
  /** 0–100 with the exact formula and inputs disclosed — never a vibe. */
  companyHealth: {
    score: number;
    formula: string;
    inputs: {
      availability: number;
      flow: number;
      approvalLoad: number;
      confidence: number;
    };
  };
  liveQueue: { running: number; waiting: number; needsApproval: number; blocked: number };
  departmentsDetail: DepartmentPulse[];
}

export const workforceHealthRoutes = new Hono<Env>();

/**
 * The command center's header: one call answering "how is the company
 * doing right now?". Every number is derived from stored records; company
 * health is a disclosed weighted formula over availability, task flow,
 * approval load, and eval confidence — not a sentiment.
 */
workforceHealthRoutes.get("/workforce/health", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const orgId = ctx.organizationId;

  const [employees, departments, tasks, approvals, runs, evalReports, usage] = await Promise.all([
    ctx.store.employees.list((e) => e.organizationId === orgId),
    ctx.store.departments.list((d) => d.organizationId === orgId),
    ctx.store.tasks.list((t) => t.organizationId === orgId),
    ctx.store.approvals.list((a) => a.organizationId === orgId && a.status === "pending"),
    ctx.store.workflowRuns.list((r) => r.organizationId === orgId),
    ctx.store.evalReports.list((r) => r.organizationId === orgId),
    perEmployeeUsage(ctx.store, orgId),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const openTasks = tasks.filter((t) => !["done", "cancelled"].includes(t.status));
  const completedToday = tasks.filter(
    (t) => t.status === "done" && t.updatedAt.startsWith(today),
  ).length;

  // Presence per employee (same derivation the cards use).
  const activityOf = new Map<string, ActivityStatus>();
  for (const e of employees) {
    const mine = tasks.filter((t) => t.assignee?.kind === "employee" && t.assignee.id === e.id);
    const pending = approvals.filter(
      (a) => a.requestedBy.kind === "employee" && a.requestedBy.id === e.id,
    );
    activityOf.set(
      e.id,
      deriveActivityStatus(e, {
        tasks: mine,
        pendingApprovals: pending,
        lastAssistantAt: usage.get(e.id)?.lastAssistantAt,
      }),
    );
  }

  // Company health — the formula is part of the contract.
  const activeEmployees = employees.filter((e) => e.status === "active").length;
  const availability = employees.length === 0 ? 1 : activeEmployees / employees.length;
  const blockedTasks = openTasks.filter((t) => t.status === "blocked").length;
  const flow = openTasks.length === 0 ? 1 : 1 - blockedTasks / openTasks.length;
  const approvalLoad = 1 / (1 + approvals.length);
  const confidence =
    evalReports.length === 0
      ? 1
      : evalReports.reduce((n, r) => n + r.passedTasks / Math.max(1, r.totalTasks), 0) /
        evalReports.length;
  const score = Math.round(
    100 * (0.4 * availability + 0.3 * flow + 0.1 * approvalLoad + 0.2 * confidence),
  );

  const departmentsDetail: DepartmentPulse[] = departments
    .map((d) => {
      const members = employees.filter((e) => e.departmentId === d.id);
      const byActivity: Partial<Record<ActivityStatus, number>> = {};
      for (const m of members) {
        const a = activityOf.get(m.id)!;
        byActivity[a] = (byActivity[a] ?? 0) + 1;
      }
      const memberIds = new Set(members.map((m) => m.id));
      const deptOpen = openTasks.filter(
        (t) => t.assignee?.kind === "employee" && memberIds.has(t.assignee.id),
      );
      const deptDoneToday = tasks.filter(
        (t) =>
          t.status === "done" &&
          t.updatedAt.startsWith(today) &&
          t.assignee?.kind === "employee" &&
          memberIds.has(t.assignee.id),
      ).length;
      const costTodayUsd = round6(
        members.reduce((n, m) => n + (usage.get(m.id)?.todayCostUsd ?? 0), 0),
      );

      const troubled = (byActivity.blocked ?? 0) + (byActivity.needs_approval ?? 0);
      const engaged = (byActivity.working ?? 0) + (byActivity.thinking ?? 0);
      const health: DepartmentHealth =
        troubled > 0
          ? "attention"
          : members.length > 0 && (engaged / members.length >= 2 / 3 || deptOpen.length > 2 * members.length)
            ? "busy"
            : "healthy";

      return {
        departmentId: d.id,
        name: d.name,
        employees: members.length,
        byActivity,
        openTasks: deptOpen.length,
        completedToday: deptDoneToday,
        costTodayUsd,
        health,
      };
    })
    .filter((d) => d.employees > 0);

  const statuses = [...activityOf.values()];
  const body: WorkforceHealth = {
    employees: employees.length,
    activeEmployees,
    departments: departmentsDetail.length,
    activeTasks: openTasks.length,
    completedToday,
    runningWorkflows: runs.filter((r) => r.status === "running" || r.status === "paused").length,
    pendingApprovals: approvals.length,
    avgResponseMs: avgOf(
      [...usage.values()].flatMap((u) => (u.todayLatencies.length ? u.todayLatencies : u.latencies)),
    ),
    costTodayUsd: round6([...usage.values()].reduce((n, u) => n + u.todayCostUsd, 0)),
    companyHealth: {
      score,
      formula:
        "100 × (0.4·availability + 0.3·flow + 0.1·approvalLoad + 0.2·confidence); availability = active/total employees, flow = 1 − blocked/open tasks, approvalLoad = 1/(1+pending approvals), confidence = avg eval pass ratio (1 when no reports)",
      inputs: {
        availability: round6(availability),
        flow: round6(flow),
        approvalLoad: round6(approvalLoad),
        confidence: round6(confidence),
      },
    },
    liveQueue: {
      running: statuses.filter((s) => s === "working" || s === "thinking").length,
      waiting: statuses.filter((s) => s === "waiting").length,
      needsApproval: statuses.filter((s) => s === "needs_approval").length,
      blocked: statuses.filter((s) => s === "blocked").length,
    },
    departmentsDetail,
  };

  return c.json(body);
});
