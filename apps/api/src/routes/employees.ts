import { Hono } from "hono";
import { Employee } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize, findScoped, parseBody } from "../http.js";

const CreateEmployee = Employee.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
});
const UpdateEmployee = CreateEmployee.partial();

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

/** Hire (create) a new AI employee. */
employeeRoutes.post("/employees", async (c) => {
  authorize(c, "employee:create");
  const ctx = c.get("ctx");
  const input = await parseBody(c, CreateEmployee);
  const employee = await ctx.store.employees.create({
    ...input,
    organizationId: ctx.organizationId,
  });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "employee.create",
    targetType: "employee",
    targetId: employee.id,
    metadata: { title: employee.title },
  });
  return c.json(employee, 201);
});

/** Update an employee's configuration. */
employeeRoutes.patch("/employees/:id", async (c) => {
  authorize(c, "employee:manage");
  const ctx = c.get("ctx");
  const existing = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const patch = await parseBody(c, UpdateEmployee);
  const updated = await ctx.store.employees.update(existing.id, patch);
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "employee.update",
    targetType: "employee",
    targetId: updated.id,
    metadata: { fields: Object.keys(patch) },
  });
  return c.json(updated);
});

/** Goals owned by an employee. */
employeeRoutes.get("/employees/:id/goals", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const goals = await ctx.store.goals.list((g) => g.employeeId === employee.id);
  return c.json({ data: goals });
});
