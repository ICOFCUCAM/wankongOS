import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../context.js";
import { authorize, findScoped } from "../http.js";
import { runAndRecord, suiteFor } from "../eval-gate.js";

export const evalRoutes = new Hono<Env>();

/** The employee's golden suite and its recent reports. */
evalRoutes.get("/employees/:id/evals", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const suite = await suiteFor(ctx, employee.id);
  const reports = suite
    ? (await ctx.store.evalReports.list((r) => r.employeeId === employee.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10)
    : [];
  return c.json({ suite, reports });
});

/** Run the employee's golden suite now and record the report. */
evalRoutes.post("/employees/:id/evals/run", async (c) => {
  authorize(c, "employee:manage");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const suite = await suiteFor(ctx, employee.id);
  if (!suite) {
    throw new HTTPException(404, { message: "No eval suite defined for this employee" });
  }
  const report = await runAndRecord(ctx, employee, suite, "manual");
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "evals.run",
    targetType: "employee",
    targetId: employee.id,
    metadata: { suiteId: suite.id, pass: report.pass, passed: report.passedTasks, total: report.totalTasks },
  });
  return c.json(report);
});

/**
 * Drift detection: compares the latest eval pass rate against the
 * employee's baseline (their best historical run). A decline of 15+
 * points is drift — reported with both numbers and notified, never
 * silently "fixed".
 */
evalRoutes.get("/employees/:id/drift", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const reports = (
    await ctx.store.evalReports.listByOrg(ctx.organizationId, (r) => r.employeeId === employee.id)
  ).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (reports.length < 2) {
    return c.json({ drifting: false, reason: "Need at least two eval runs to measure drift.", runs: reports.length });
  }
  const rate = (r: (typeof reports)[number]) => r.passedTasks / Math.max(1, r.totalTasks);
  const baseline = Math.max(...reports.slice(0, -1).map(rate));
  const recent = rate(reports[reports.length - 1]!);
  const delta = Math.round((recent - baseline) * 100);
  const drifting = delta <= -15;
  if (drifting) {
    const { notify } = await import("../notify.js");
    await notify(ctx.store, ctx.organizationId, {
      kind: "eval.drift",
      title: `${employee.name}'s eval pass rate dropped ${Math.abs(delta)} points`,
      body: `Baseline ${Math.round(baseline * 100)}% → recent ${Math.round(recent * 100)}%. Review recent config changes or roll back.`,
      link: `/employees/${employee.id}`,
    });
  }
  return c.json({
    drifting,
    baseline: Math.round(baseline * 100),
    recent: Math.round(recent * 100),
    delta,
    runs: reports.length,
    method: "baseline = best historical pass rate; drift = latest run 15+ points below it",
  });
});
