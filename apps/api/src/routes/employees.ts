import { Hono } from "hono";
import { z } from "zod";
import { Employee, EmployeeStatus } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize, findScoped, parseBody } from "../http.js";
import { runAndRecord, suiteFor, touchesGatedFields } from "../eval-gate.js";
import { emitEvent } from "../events.js";

const CreateEmployee = Employee.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
}).extend({
  /** Optional on hire; defaults to probation ("training") — see route. */
  status: EmployeeStatus.optional(),
});
const UpdateEmployee = CreateEmployee.partial();

const RollbackInput = z.object({ version: z.number().int().positive() });

export const employeeRoutes = new Hono<Env>();

/** List employees, optionally filtered by department. */
employeeRoutes.get("/employees", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const department = c.req.query("departmentId");
  const employees = await ctx.store.employees.list(
    (e) =>
      e.organizationId === ctx.organizationId &&
      (department ? e.departmentId === department : true),
  );
  return c.json({ data: employees });
});

/** Get one employee. */
employeeRoutes.get("/employees/:id", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  return c.json(employee);
});

/**
 * Hire (create) a new AI employee.
 *
 * Probation by default: new hires start in status "training" — chattable via
 * evals but not taking real work — and graduate to active via
 * `POST /employees/:id/activate`, which requires passing their eval suite.
 */
employeeRoutes.post("/employees", async (c) => {
  authorize(c, "employee:create");
  const ctx = c.get("ctx");
  const input = await parseBody(c, CreateEmployee);
  const employee = await ctx.store.employees.create({
    ...input,
    status: input.status ?? "training",
    organizationId: ctx.organizationId,
  });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "employee.create",
    targetType: "employee",
    targetId: employee.id,
    metadata: { title: employee.title, status: employee.status },
  });
  await emitEvent(ctx, "employee.hired", {
    employeeId: employee.id,
    name: employee.name,
    title: employee.title,
    status: employee.status,
  });
  return c.json(employee, 201);
});

/**
 * Update an employee's configuration.
 *
 * Regression gate (AI QA): when the patch touches behaviour-defining fields and
 * the employee has a golden-task suite, the PROPOSED configuration is evaluated
 * first. A failing suite rejects the change with 422 and the report — a config
 * edit that breaks the employee's tested behaviour cannot go live.
 */
employeeRoutes.patch("/employees/:id", async (c) => {
  authorize(c, "employee:manage");
  const ctx = c.get("ctx");
  const existing = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const patch = await parseBody(c, UpdateEmployee);

  let gateReport = null;
  if (touchesGatedFields(patch)) {
    const suite = await suiteFor(ctx, existing.id);
    if (suite) {
      const proposed = { ...existing, ...patch };
      gateReport = await runAndRecord(ctx, proposed, suite, "gate");
      if (!gateReport.pass) {
        await ctx.store.audit({
          organizationId: ctx.organizationId,
          actor: { kind: "user", id: c.get("actor").user.id },
          action: "employee.update.blocked_by_evals",
          targetType: "employee",
          targetId: existing.id,
          metadata: { fields: Object.keys(patch), reportId: gateReport.id },
        });
        return c.json(
          {
            error: "Change rejected: the proposed configuration fails this employee's eval suite",
            report: gateReport,
          },
          422,
        );
      }
    }
  }

  await snapshotVersion(ctx, existing, c.get("actor").user.id, Object.keys(patch));
  const updated = await ctx.store.employees.update(existing.id, patch);
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "employee.update",
    targetType: "employee",
    targetId: updated.id,
    metadata: { fields: Object.keys(patch), gateReportId: gateReport?.id ?? null },
  });
  return c.json({ ...updated, gateReport });
});

/** Version history: every config change stores the prior configuration. */
employeeRoutes.get("/employees/:id/versions", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const versions = await ctx.store.employeeVersions.list((v) => v.employeeId === employee.id);
  versions.sort((a, b) => b.version - a.version);
  return c.json({ data: versions });
});

/**
 * Roll back to a stored version. The restored configuration passes through the
 * same eval gate as any edit — a rollback that fails the suite is rejected.
 */
employeeRoutes.post("/employees/:id/rollback", async (c) => {
  authorize(c, "employee:manage");
  const ctx = c.get("ctx");
  const existing = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const { version } = await parseBody(c, RollbackInput);

  const target = (
    await ctx.store.employeeVersions.list(
      (v) => v.employeeId === existing.id && v.version === version,
    )
  )[0];
  if (!target) return c.json({ error: `No stored version ${version} for this employee` }, 404);

  // Restore the FULL configuration: every non-identity field takes the
  // snapshot's value — explicitly undefined for fields the snapshot didn't
  // have, so options added later (e.g. a budget) don't survive the rollback.
  const IDENTITY_FIELDS = new Set(["id", "createdAt", "updatedAt", "organizationId"]);
  const snapshot = target.snapshot as Record<string, unknown>;
  const restored: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(existing), ...Object.keys(snapshot)])) {
    if (!IDENTITY_FIELDS.has(key)) restored[key] = snapshot[key];
  }
  const patch = restored as Partial<Employee>;

  const suite = await suiteFor(ctx, existing.id);
  let gateReport = null;
  if (suite) {
    gateReport = await runAndRecord(ctx, { ...existing, ...patch } as Employee, suite, "gate");
    if (!gateReport.pass) {
      return c.json(
        { error: `Rollback to version ${version} fails the eval suite`, report: gateReport },
        422,
      );
    }
  }

  await snapshotVersion(ctx, existing, c.get("actor").user.id, [`rollback to v${version}`]);
  const updated = await ctx.store.employees.update(existing.id, patch);
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "employee.rollback",
    targetType: "employee",
    targetId: existing.id,
    metadata: { toVersion: version, gateReportId: gateReport?.id ?? null },
  });
  return c.json({ ...updated, gateReport });
});

/** Store the employee's current config as the next version snapshot. */
async function snapshotVersion(
  ctx: Env["Variables"]["ctx"],
  employee: Employee,
  changedBy: string,
  changedFields: string[],
) {
  const count = await ctx.store.employeeVersions.count((v) => v.employeeId === employee.id);
  await ctx.store.employeeVersions.create({
    organizationId: ctx.organizationId,
    employeeId: employee.id,
    version: count + 1,
    changedBy,
    changeSummary: changedFields.join(", ").slice(0, 500),
    snapshot: { ...employee },
  });
}

/** Goals owned by an employee. */
employeeRoutes.get("/employees/:id/goals", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const goals = await ctx.store.goals.list((g) => g.employeeId === employee.id);
  return c.json({ data: goals });
});
