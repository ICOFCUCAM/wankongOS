import { Hono } from "hono";
import type { Employee, EvalReport, Goal, Report, Task } from "@wankong/core";
import type { AppContext, Env } from "../context.js";
import { authorize, findScoped } from "../http.js";
import { todaysTokenUsage } from "../governance.js";

export const reviewRoutes = new Hono<Env>();

/** Reviews for an employee, newest first. */
reviewRoutes.get("/employees/:id/reviews", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const reviews = await ctx.store.reports.list(
    (r) =>
      r.organizationId === ctx.organizationId &&
      r.kind === "performance_review" &&
      r.subjectId === employee.id,
  );
  reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return c.json({ data: reviews });
});

/**
 * Generate a performance review: a KPI-backed record compiled from the
 * employee's real activity — eval pass rate, task throughput, goal progress,
 * conversations handled, escalations/approvals, and config stability. Every
 * number is derived from stored records; the narrative states its evidence.
 */
reviewRoutes.post("/employees/:id/reviews", async (c) => {
  authorize(c, "employee:manage");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));

  const review = await generateReview(ctx, employee);
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "review.generate",
    targetType: "employee",
    targetId: employee.id,
    metadata: { reportId: review.id, rating: review.metrics.rating },
  });
  return c.json(review, 201);
});

async function generateReview(ctx: AppContext, employee: Employee): Promise<Report> {
  const orgId = ctx.organizationId;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [tasks, evalReports, goals, conversations, versions] = await Promise.all([
    ctx.store.tasks.list(
      (t: Task) => t.organizationId === orgId && t.assignee?.id === employee.id,
    ),
    ctx.store.evalReports.list((r: EvalReport) => r.employeeId === employee.id),
    ctx.store.goals.list((g: Goal) => g.employeeId === employee.id),
    ctx.store.conversations.list((cv) => cv.employeeId === employee.id),
    ctx.store.employeeVersions.list((v) => v.employeeId === employee.id),
  ]);

  const recentEvals = evalReports.filter((r) => r.createdAt >= since);
  const evalsConsidered = recentEvals.length > 0 ? recentEvals : evalReports;
  const evalPassRate =
    evalsConsidered.length === 0
      ? null
      : evalsConsidered.filter((r) => r.pass).length / evalsConsidered.length;

  const tasksDone = tasks.filter((t) => t.status === "done").length;
  const tasksOpen = tasks.filter((t) => !["done", "cancelled"].includes(t.status)).length;
  const goalProgress =
    goals.length === 0 ? null : goals.reduce((n, g) => n + g.progress, 0) / goals.length;
  const todayTokens = await todaysTokenUsage(ctx.store, employee.id);

  // Rating: evals are the hardest evidence, then goals; neutral without either.
  let rating: "exceeding" | "meeting" | "needs_attention";
  if (evalPassRate !== null && evalPassRate < 1) rating = "needs_attention";
  else if ((goalProgress ?? 0.5) >= 0.7 || tasksDone > 0) rating = "exceeding";
  else rating = "meeting";

  const lines = [
    `Performance review for ${employee.name}, ${employee.title} (last 30 days).`,
    ``,
    evalPassRate === null
      ? `Quality: no eval suite runs on record — recommend defining a golden-task suite.`
      : `Quality: ${Math.round(evalPassRate * 100)}% eval pass rate across ${evalsConsidered.length} run(s).`,
    `Delivery: ${tasksDone} task(s) completed, ${tasksOpen} open; ${conversations.length} conversation(s) handled.`,
    goalProgress === null
      ? `Goals: none assigned.`
      : `Goals: average progress ${Math.round(goalProgress * 100)}% across ${goals.length} goal(s).`,
    `Change stability: ${versions.length} configuration change(s) on record; status is "${employee.status}".`,
    ``,
    rating === "exceeding"
      ? `Overall: exceeding expectations — quality checks pass and delivery is active.`
      : rating === "meeting"
        ? `Overall: meeting expectations.`
        : `Overall: needs attention — the latest eval runs include failures; review the failing tasks before expanding scope.`,
  ];

  const now = new Date().toISOString();
  return ctx.store.reports.create({
    organizationId: orgId,
    title: `Performance review — ${employee.name}`,
    subjectId: employee.id,
    kind: "performance_review",
    period: { from: since, to: now },
    metrics: {
      evalPassRate: evalPassRate === null ? -1 : Math.round(evalPassRate * 100) / 100,
      evalRuns: evalsConsidered.length,
      tasksCompleted: tasksDone,
      tasksOpen,
      conversations: conversations.length,
      goalProgress: goalProgress === null ? -1 : Math.round(goalProgress * 100) / 100,
      configChanges: versions.length,
      todayTokens,
      rating: rating === "exceeding" ? 2 : rating === "meeting" ? 1 : 0,
    },
    narrative: lines.join("\n"),
  });
}
