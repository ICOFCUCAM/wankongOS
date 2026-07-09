import { cronMatches, isValidCron, newId } from "@wankong/core";
import type { AppContext } from "./context.js";
import { emitEvent } from "./events.js";

export interface TickResult {
  checked: number;
  started: { workflowId: string; runId: string; status: string }[];
  skipped: { workflowId: string; reason: string }[];
}

/**
 * One scheduler tick (minute resolution): start every active workflow whose
 * cron schedule matches `now` and which hasn't already been started by the
 * scheduler this minute (idempotent — safe to call multiple times per minute,
 * from the worker loop, a platform cron, or manually).
 */
export async function runScheduledWorkflows(
  ctx: AppContext,
  now: Date = new Date(),
): Promise<TickResult> {
  const workflows = await ctx.store.workflows.list(
    (w) => w.organizationId === ctx.organizationId && w.active && w.trigger.kind === "schedule",
  );

  const result: TickResult = { checked: workflows.length, started: [], skipped: [] };
  const minutePrefix = now.toISOString().slice(0, 16); // e.g. 2026-07-09T09:00

  for (const workflow of workflows) {
    const schedule = workflow.trigger.schedule;
    if (!schedule || !isValidCron(schedule)) {
      result.skipped.push({ workflowId: workflow.id, reason: "invalid or missing cron" });
      continue;
    }
    if (!cronMatches(schedule, now)) continue;

    // Idempotency: one scheduler-started run per workflow per minute, keyed on
    // the run's own scheduledAt input (not wall-clock createdAt).
    const already = await ctx.store.workflowRuns.count(
      (r) =>
        r.workflowId === workflow.id &&
        r.startedBy.kind === "system" &&
        r.startedBy.id === "scheduler" &&
        typeof r.context.scheduledAt === "string" &&
        (r.context.scheduledAt as string).startsWith(minutePrefix),
    );
    if (already > 0) {
      result.skipped.push({ workflowId: workflow.id, reason: "already ran this minute" });
      continue;
    }

    const run = await ctx.workflowEngine.start(
      workflow,
      { scheduledAt: now.toISOString() },
      { kind: "system", id: "scheduler" },
      newId("workflowRun"),
    );
    await ctx.store.workflowRuns.insert(run);
    await ctx.store.audit({
      organizationId: ctx.organizationId,
      actor: { kind: "user", id: "scheduler" },
      action: "workflow.run.scheduled",
      targetType: "workflow",
      targetId: workflow.id,
      metadata: { runId: run.id, status: run.status, schedule },
    });
    await emitEvent(ctx, `workflow.run.${run.status}`, {
      runId: run.id,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: run.status,
      scheduled: true,
    });
    result.started.push({ workflowId: workflow.id, runId: run.id, status: run.status });
  }

  return result;
}
