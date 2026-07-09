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
