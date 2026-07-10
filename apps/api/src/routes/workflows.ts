import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { Workflow, validateWorkflowGraph } from "@wankong/core";
import type { Env } from "../context.js";
import { newWorkflowRunId } from "../context.js";
import { authorize, findScoped, parseBody } from "../http.js";
import { emitEvent } from "../events.js";

const RunInput = z.object({ input: z.record(z.unknown()).default({}) });

/** A definition as the builder submits it — server owns id/org/timestamps. */
const WorkflowInput = Workflow.omit({ id: true, organizationId: true, createdAt: true, updatedAt: true });

/**
 * Reject definitions the schema can't catch: dangling edges, unreachable
 * nodes, and employee nodes pointing outside this organization. Returns the
 * problem list for a 422 body, or null when the definition is runnable.
 */
async function graphProblems(
  ctx: Env["Variables"]["ctx"],
  input: z.infer<typeof WorkflowInput>,
): Promise<string[] | null> {
  const problems = validateWorkflowGraph(input.nodes, input.entryNodeId);
  const employeeIds = new Set(
    (await ctx.store.employees.listByOrg(ctx.organizationId)).map((e) => e.id),
  );
  for (const n of input.nodes) {
    if (n.type === "employee" && !employeeIds.has(n.employeeId)) {
      problems.push(`Node "${n.id}" assigns work to unknown employee "${n.employeeId}".`);
    }
  }
  return problems.length > 0 ? problems : null;
}

export const workflowRoutes = new Hono<Env>();

/** Create a workflow definition (the visual builder's save). */
workflowRoutes.post("/workflows", async (c) => {
  authorize(c, "workflow:manage");
  const ctx = c.get("ctx");
  const input = await parseBody(c, WorkflowInput);
  const problems = await graphProblems(ctx, input);
  if (problems) return c.json({ error: "Workflow graph is not runnable", problems }, 422);

  const workflow = await ctx.store.workflows.create({ ...input, organizationId: ctx.organizationId });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "workflow.create",
    targetType: "workflow",
    targetId: workflow.id,
    metadata: { name: workflow.name, nodes: workflow.nodes.length },
  });
  return c.json(workflow, 201);
});

/** Replace a workflow definition (the visual builder's edit-save). */
workflowRoutes.put("/workflows/:id", async (c) => {
  authorize(c, "workflow:manage");
  const ctx = c.get("ctx");
  const existing = await findScoped(c, (id) => ctx.store.workflows.get(id), c.req.param("id"));
  const input = await parseBody(c, WorkflowInput);
  const problems = await graphProblems(ctx, input);
  if (problems) return c.json({ error: "Workflow graph is not runnable", problems }, 422);

  const workflow = await ctx.store.workflows.update(existing.id, { ...input });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "workflow.update",
    targetType: "workflow",
    targetId: existing.id,
    metadata: { name: input.name, nodes: input.nodes.length },
  });
  return c.json(workflow);
});

/** List workflow definitions. */
workflowRoutes.get("/workflows", async (c) => {
  authorize(c, "workflow:read");
  const ctx = c.get("ctx");
  return c.json({ data: await ctx.store.workflowsByOrg(ctx.organizationId) });
});

/** Get one workflow with its recent runs. */
workflowRoutes.get("/workflows/:id", async (c) => {
  authorize(c, "workflow:read");
  const ctx = c.get("ctx");
  const workflow = await findScoped(c, (id) => ctx.store.workflows.get(id), c.req.param("id"));
  const runs = await ctx.store.runsForWorkflow(workflow.id);
  return c.json({ workflow, runs: runs.slice(0, 20) });
});

/** Start a run. Executes synchronously until completion or an approval pause. */
workflowRoutes.post("/workflows/:id/run", async (c) => {
  authorize(c, "workflow:run");
  const ctx = c.get("ctx");
  const workflow = await findScoped(c, (id) => ctx.store.workflows.get(id), c.req.param("id"));
  const { input } = await parseBody(c, RunInput);

  const run = await ctx.workflowEngine.start(
    workflow,
    input,
    { kind: "user", id: c.get("actor").user.id },
    newWorkflowRunId(),
  );
  await ctx.store.workflowRuns.insert(run);

  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "workflow.run.start",
    targetType: "workflow",
    targetId: workflow.id,
    metadata: { runId: run.id, status: run.status },
  });

  await emitEvent(ctx, `workflow.run.${run.status}`, {
    runId: run.id,
    workflowId: workflow.id,
    workflowName: workflow.name,
    status: run.status,
  });

  return c.json(run, 201);
});

/** Get a single run. */
workflowRoutes.get("/workflows/runs/:runId", async (c) => {
  authorize(c, "workflow:read");
  const ctx = c.get("ctx");
  const run = await findScoped(
    c,
    (id) => ctx.store.workflowRuns.get(id),
    c.req.param("runId"),
  );
  return c.json(run);
});

/** List runs across the organization (most recent first). */
workflowRoutes.get("/runs", async (c) => {
  authorize(c, "workflow:read");
  const ctx = c.get("ctx");
  const runs = await ctx.store.workflowRuns.list((r) => r.organizationId === ctx.organizationId);
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return c.json({ data: runs });
});

/**
 * Resume a paused run after an approval decision. Called by the approvals
 * handler; also exposed directly for operational control.
 */
export async function resumePausedRun(
  ctx: Env["Variables"]["ctx"],
  approvalId: string,
  decision: "approved" | "rejected",
): Promise<void> {
  const runs = await ctx.store.workflowRuns.list(
    (r) => r.pendingApprovalId === approvalId && r.status === "paused",
  );
  const run = runs[0];
  if (!run) return;
  const workflow = await ctx.store.workflows.get(run.workflowId);
  if (!workflow) throw new HTTPException(500, { message: "Workflow definition missing for run" });
  const resumed = await ctx.workflowEngine.resume(workflow, run, decision);
  await ctx.store.workflowRuns.insert(resumed);
  await emitEvent(ctx, `workflow.run.${resumed.status}`, {
    runId: resumed.id,
    workflowId: workflow.id,
    workflowName: workflow.name,
    status: resumed.status,
  });
}
