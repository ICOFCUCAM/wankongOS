import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../context.js";
import { authorize, findScoped } from "../http.js";
import { runAndRecord, suiteFor } from "../eval-gate.js";
import { todaysTokenUsage } from "../governance.js";

export const lifecycleRoutes = new Hono<Env>();

/** Pause one employee (individual kill switch). */
lifecycleRoutes.post("/employees/:id/pause", async (c) => {
  authorize(c, "employee:manage");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  if (employee.status === "paused") return c.json(employee);
  const updated = await ctx.store.employees.update(employee.id, { status: "paused" });
  await audit(c, "employee.pause", employee.id);
  return c.json(updated);
});

/** Resume a paused employee. Training employees graduate via /activate instead. */
lifecycleRoutes.post("/employees/:id/resume", async (c) => {
  authorize(c, "employee:manage");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  if (employee.status !== "paused") {
    throw new HTTPException(409, { message: `Cannot resume an employee that is ${employee.status}` });
  }
  const updated = await ctx.store.employees.update(employee.id, { status: "active" });
  await audit(c, "employee.resume", employee.id);
  return c.json(updated);
});

/**
 * Graduate an employee from probation (status "training") to active.
 *
 * Trust is earned by evidence: when the employee has a golden-task suite, it
 * runs against the current configuration and must PASS — a failing suite
 * rejects activation with 422 and the report.
 */
lifecycleRoutes.post("/employees/:id/activate", async (c) => {
  authorize(c, "employee:manage");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  if (employee.status !== "training") {
    throw new HTTPException(409, { message: `Only training employees can be activated (status: ${employee.status})` });
  }

  const suite = await suiteFor(ctx, employee.id);
  let report = null;
  if (suite) {
    report = await runAndRecord(ctx, employee, suite, "gate");
    if (!report.pass) {
      await audit(c, "employee.activation.blocked_by_evals", employee.id, { reportId: report.id });
      return c.json(
        { error: "Activation rejected: the employee fails its eval suite", report },
        422,
      );
    }
  }

  const updated = await ctx.store.employees.update(employee.id, { status: "active" });
  await audit(c, "employee.activate", employee.id, { reportId: report?.id ?? null });
  return c.json({ ...updated, activationReport: report });
});

/**
 * Clone an employee: same configuration (prompt, personality, rules, tools,
 * budget), fresh identity — and probation status, because trust is earned per
 * employee, not inherited from the original.
 */
lifecycleRoutes.post("/employees/:id/clone", async (c) => {
  authorize(c, "employee:create");
  const ctx = c.get("ctx");
  const source = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const { id: _id, createdAt: _c, updatedAt: _u, ...config } = source;
  const clone = await ctx.store.employees.create({
    ...config,
    name: `${source.name} (Clone)`,
    status: "training",
  });
  await audit(c, "employee.clone", clone.id, { sourceId: source.id });
  return c.json(clone, 201);
});

/** Org-wide kill switch: pause every active employee at once. */
lifecycleRoutes.post("/workforce/pause", async (c) => {
  authorize(c, "org:manage");
  const ctx = c.get("ctx");
  const active = await ctx.store.employees.list(
    (e) => e.organizationId === ctx.organizationId && e.status === "active",
  );
  for (const e of active) await ctx.store.employees.update(e.id, { status: "paused" });
  await audit(c, "workforce.pause", undefined, { paused: active.length });
  return c.json({ paused: active.length });
});

/** Reverse the kill switch: paused employees return to active (training stays). */
lifecycleRoutes.post("/workforce/resume", async (c) => {
  authorize(c, "org:manage");
  const ctx = c.get("ctx");
  const paused = await ctx.store.employees.list(
    (e) => e.organizationId === ctx.organizationId && e.status === "paused",
  );
  for (const e of paused) await ctx.store.employees.update(e.id, { status: "active" });
  await audit(c, "workforce.resume", undefined, { resumed: paused.length });
  return c.json({ resumed: paused.length });
});

/** Today's token spend vs. budget for an employee. */
lifecycleRoutes.get("/employees/:id/usage", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const todayTokens = await todaysTokenUsage(ctx.store, employee.id);
  return c.json({
    todayTokens,
    dailyTokenBudget: employee.dailyTokenBudget ?? null,
    remaining: employee.dailyTokenBudget ? Math.max(0, employee.dailyTokenBudget - todayTokens) : null,
  });
});

async function audit(
  c: Context<Env>,
  action: string,
  targetId?: string,
  metadata: Record<string, unknown> = {},
) {
  const ctx = c.get("ctx");
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action,
    targetType: targetId ? "employee" : "workforce",
    targetId,
    metadata,
  });
}
