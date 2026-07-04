import { Hono } from "hono";
import { z } from "zod";
import { Task } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize, findScoped, parseBody } from "../http.js";

const CreateTask = Task.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
  createdBy: true,
});
const UpdateTask = CreateTask.partial();

const DecideApproval = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().max(2000).optional(),
});

export const taskRoutes = new Hono<Env>();

/** List tasks, optionally filtered by status or assignee. */
taskRoutes.get("/tasks", async (c) => {
  authorize(c, "task:read");
  const ctx = c.get("ctx");
  const status = c.req.query("status");
  const assignee = c.req.query("assigneeId");
  const tasks = await ctx.store.tasks.list(
    (t) =>
      t.organizationId === ctx.organizationId &&
      (status ? t.status === status : true) &&
      (assignee ? t.assignee?.id === assignee : true),
  );
  tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return c.json({ data: tasks });
});

/** Create a task. The creator is the authenticated actor. */
taskRoutes.post("/tasks", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const input = await parseBody(c, CreateTask);
  const task = await ctx.store.tasks.create({
    ...input,
    organizationId: ctx.organizationId,
    createdBy: { kind: "user", id: c.get("actor").user.id },
  });
  return c.json(task, 201);
});

/** Update a task (status transitions, reassignment, results). */
taskRoutes.patch("/tasks/:id", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const existing = await findScoped(c, (id) => ctx.store.tasks.get(id), c.req.param("id"));
  const patch = await parseBody(c, UpdateTask);
  if (patch.assignee && !patch.assignee.id) {
    // guard handled by schema; kept for clarity
  }
  const updated = await ctx.store.tasks.update(existing.id, patch);
  return c.json(updated);
});

/** Pending approvals awaiting a human decision. */
taskRoutes.get("/approvals", async (c) => {
  authorize(c, "task:read");
  const ctx = c.get("ctx");
  const approvals = await ctx.store.approvals.list(
    (a) => a.organizationId === ctx.organizationId && a.status === "pending",
  );
  return c.json({ data: approvals });
});

/** Decide an approval (approve/reject). Requires task:approve. */
taskRoutes.post("/approvals/:id/decision", async (c) => {
  authorize(c, "task:approve");
  const ctx = c.get("ctx");
  const approval = await findScoped(c, (id) => ctx.store.approvals.get(id), c.req.param("id"));
  const { decision, reason } = await parseBody(c, DecideApproval);
  const updated = await ctx.store.approvals.update(approval.id, {
    status: decision,
    decidedBy: c.get("actor").user.id,
    decidedAt: new Date().toISOString(),
    reason,
  });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: `approval.${decision}`,
    targetType: "approval",
    targetId: updated.id,
    metadata: {},
  });
  return c.json(updated);
});
