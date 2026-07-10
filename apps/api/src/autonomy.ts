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
    ctx.store.tasks.list((t) => t.organizationId === ctx.organizationId && t.status === "todo"),
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
