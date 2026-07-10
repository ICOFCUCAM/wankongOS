import type { Employee, Task } from "@wankong/core";
import type { AppContext } from "./context.js";
import { buildGroundedEmployeeContext } from "./employee-context.js";
import { composeToolRegistry } from "./mcp-tools.js";
import { todaysTokenUsage } from "./governance.js";
import { notify } from "./notify.js";

export interface WorkCycleResult {
  scanned: number;
  completed: { employeeId: string; taskId: string; title: string }[];
  approvalsRequested: { employeeId: string; taskId: string }[];
  skipped: { employeeId: string; taskId: string; reason: string }[];
}

/**
 * The autonomous work cycle (ADR-0024): idle ACTIVE employees claim their
 * oldest queued task and genuinely work it — runtime + tools + recorded
 * conversation — then complete it with a result. Governance is structural:
 *
 *  - autonomy "low"  → the employee REQUESTS APPROVAL to start (once per
 *    task); a human approves before any execution.
 *  - daily token budget → exceeded employees are skipped, with the reason.
 *  - paused/training employees never work (same rule as chat).
 *
 * Every completion flows through the same records the console derives from:
 * the task flips to done with a result, the exchange is a real conversation,
 * and the audit trail carries `autonomy.task.complete`.
 */
export async function runWorkCycle(
  ctx: AppContext,
  options: { maxTasks?: number } = {},
): Promise<WorkCycleResult> {
  const max = options.maxTasks ?? 3;
  const result: WorkCycleResult = { scanned: 0, completed: [], approvalsRequested: [], skipped: [] };

  const [employees, tasks, approvals] = await Promise.all([
    ctx.store.employees.list((e) => e.organizationId === ctx.organizationId && e.status === "active"),
    ctx.store.tasks.listByOrg(
      ctx.organizationId,
      (t) =>
        t.status === "todo" ||
        (t.status === "in_progress" && !!t.checkpoint && t.checkpoint.completed < t.checkpoint.steps.length),
    ),
    ctx.store.approvals.list((a) => a.organizationId === ctx.organizationId),
  ]);

  const queue: { employee: Employee; task: Task }[] = [];
  for (const e of employees) {
    const mine = tasks
      .filter((t) => t.assignee?.kind === "employee" && t.assignee.id === e.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (mine[0]) queue.push({ employee: e, task: mine[0] });
  }
  result.scanned = queue.length;

  for (const { employee, task } of queue.slice(0, max)) {
    // Governance gate 1: low autonomy asks first — and honors the answer.
    if (employee.personality.autonomy === "low") {
      const forTask = approvals.filter((a) => a.summary.includes(task.id) || a.taskId === task.id);
      const approved = forTask.some((a) => a.status === "approved");
      const rejected = forTask.some((a) => a.status === "rejected");
      if (rejected) {
        await ctx.store.tasks.update(task.id, { status: "cancelled" });
        await ctx.store.audit({
          organizationId: ctx.organizationId,
          actor: { kind: "employee", id: employee.id },
          action: "autonomy.task.stand_down",
          targetType: "task",
          targetId: task.id,
          metadata: { title: task.title },
        });
        result.skipped.push({ employeeId: employee.id, taskId: task.id, reason: "approval_rejected" });
        continue;
      }
      if (!approved) {
      const already = forTask.some((a) => a.status === "pending");
      if (!already) {
        await ctx.store.approvals.create({
          organizationId: ctx.organizationId,
          taskId: task.id,
          requestedBy: { kind: "employee", id: employee.id },
          summary: `${employee.name} requests approval to start “${task.title}” (${task.id}) — autonomy is set to low.`,
          requiredPermission: "task:approve",
          status: "pending",
        });
        await notify(ctx.store, ctx.organizationId, {
          kind: "approval.pending",
          title: `${employee.name} requests approval to start “${task.title}”`,
          body: "Autonomy is set to low for this employee — approve or reject in the task board.",
          link: "/tasks",
        });
        result.approvalsRequested.push({ employeeId: employee.id, taskId: task.id });
      } else {
        result.skipped.push({ employeeId: employee.id, taskId: task.id, reason: "awaiting_approval" });
      }
      continue;
      }
      // Approved: fall through and work the task like any other.
    }

    // Governance gate 2: budget.
    if (employee.dailyTokenBudget) {
      const used = await todaysTokenUsage(ctx.store, employee.id);
      if (used >= employee.dailyTokenBudget) {
        result.skipped.push({ employeeId: employee.id, taskId: task.id, reason: "budget_exhausted" });
        continue;
      }
    }

    // Long jobs: one CHECKPOINTED step per cycle — interruptible, resumable,
    // budget-checked per step, with state on the task record itself.
    if (task.checkpoint && task.checkpoint.completed < task.checkpoint.steps.length) {
      const cp = task.checkpoint;
      const step = cp.steps[cp.completed]!;
      const grounded = await buildGroundedEmployeeContext(ctx.store, ctx.organizationId, employee, {
        query: step,
        embedder: ctx.embedder,
      });
      const run = await ctx.runtime.complete({
        employee,
        context: grounded.context,
        input: `You are working the long-running task “${task.title}” step by step.\nCompleted so far:\n${cp.notes.map((n, i) => `${i + 1}. ${n.slice(0, 200)}`).join("\n") || "(nothing yet)"}\n\nCurrent step (${cp.completed + 1}/${cp.steps.length}): ${step}\nComplete ONLY this step and reply with its deliverable.`,
        tools: {
          registry: await composeToolRegistry(ctx.toolRegistry, ctx.store, ctx.organizationId),
          context: { organizationId: ctx.organizationId, employeeId: employee.id, permissions: employee.permissions },
        },
      });
      const completed = cp.completed + 1;
      const notes = [...cp.notes, `[${step}] ${run.text.slice(0, 2000)}`];
      const finished = completed >= cp.steps.length;
      await ctx.store.tasks.update(task.id, {
        status: finished ? "done" : "in_progress",
        progress: Math.round((completed / cp.steps.length) * 100) / 100,
        checkpoint: { steps: cp.steps, completed, notes },
        ...(finished ? { result: notes.join("\n\n").slice(0, 20000) } : {}),
      });
      await ctx.store.audit({
        organizationId: ctx.organizationId,
        actor: { kind: "employee", id: employee.id },
        action: finished ? "autonomy.task.complete" : "autonomy.task.checkpoint",
        targetType: "task",
        targetId: task.id,
        metadata: { title: task.title, step: completed, of: cp.steps.length },
      });
      if (finished) result.completed.push({ employeeId: employee.id, taskId: task.id, title: task.title });
      else result.skipped.push({ employeeId: employee.id, taskId: task.id, reason: `checkpointed_${completed}/${cp.steps.length}` });
      continue;
    }

    // Claim.
    await ctx.store.tasks.update(task.id, { status: "in_progress", progress: 0 });

    // Work: a real runtime run with tools, recorded as a real conversation.
    const grounded = await buildGroundedEmployeeContext(ctx.store, ctx.organizationId, employee, {
      query: task.title,
      embedder: ctx.embedder,
    });
    const input = `You have been assigned this task. Complete it now and reply with the deliverable.\n\nTitle: ${task.title}\nDetails: ${task.description || "none"}\n\nUse your tools where useful. Be concrete.`;
    const startedAt = Date.now();
    const run = await ctx.runtime.complete({
      employee,
      context: grounded.context,
      input,
      tools: {
        registry: await composeToolRegistry(ctx.toolRegistry, ctx.store, ctx.organizationId),
        context: { organizationId: ctx.organizationId, employeeId: employee.id, permissions: employee.permissions },
      },
    });

    const conversation = await ctx.store.conversations.create({
      organizationId: ctx.organizationId,
      employeeId: employee.id,
      openedBy: { kind: "employee", id: employee.id },
      title: `Task: ${task.title}`.slice(0, 200),
    });
    await ctx.store.messages.create({ conversationId: conversation.id, role: "user", content: input });
    await ctx.store.messages.create({
      conversationId: conversation.id,
      role: "assistant",
      authorId: employee.id,
      content: run.text,
      tokensIn: run.usage.inputTokens,
      tokensOut: run.usage.outputTokens,
      provider: run.provider,
      model: run.model,
      latencyMs: Date.now() - startedAt,
    });

    await ctx.store.tasks.update(task.id, {
      status: "done",
      progress: 1,
      result: run.text.slice(0, 20000),
    });
    await ctx.store.audit({
      organizationId: ctx.organizationId,
      actor: { kind: "employee", id: employee.id },
      action: "autonomy.task.complete",
      targetType: "task",
      targetId: task.id,
      metadata: { title: task.title, conversationId: conversation.id },
    });
    result.completed.push({ employeeId: employee.id, taskId: task.id, title: task.title });
  }

  return result;
}
