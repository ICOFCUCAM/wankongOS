import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { LocalEmbedder } from "@wankong/knowledge";
import { createApp } from "../src/app.js";
import { createAppContext, type AppContext } from "../src/context.js";
import { runWorkCycle } from "../src/autonomy.js";

let ctx: AppContext;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  ctx = createAppContext({
    store: createSeededStore(),
    registry: new ProviderRegistry(),
    embedder: new LocalEmbedder(),
    organizationId: SEED_ORG_ID,
  });
  app = createApp({ context: ctx, quiet: true });
  await ctx.ready;
});

describe("autonomous work cycle (ADR-0024)", () => {
  it("an idle employee claims its queued task, works it, and completes with a result", async () => {
    // Seeded: sales director (autonomy high) has a todo outreach task.
    const result = await runWorkCycle(ctx);
    const done = result.completed.find((c) => c.employeeId === "emp_sales_director");
    expect(done).toBeDefined();

    const task = await ctx.store.tasks.get(done!.taskId);
    expect(task!.status).toBe("done");
    expect(task!.result!.length).toBeGreaterThan(0);

    // The work is a real recorded conversation → usage, presence, pulse all derive.
    const convos = await ctx.store.conversations.list((cv) => cv.employeeId === "emp_sales_director");
    expect(convos.some((cv) => cv.title.startsWith("Task:"))).toBe(true);
    const audits = await ctx.store.auditEvents.list((a) => a.action === "autonomy.task.complete");
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("low-autonomy employees request approval instead of acting, exactly once", async () => {
    const zoeTask = await ctx.store.tasks.create({
      organizationId: SEED_ORG_ID,
      title: "Review supplier framework agreement",
      description: "",
      status: "todo",
      priority: "normal",
      assignee: { kind: "employee", id: "emp_legal" }, // autonomy low
      createdBy: { kind: "user", id: "usr_ceo" },
      labels: [],
    });
    const first = await runWorkCycle(ctx, { maxTasks: 10 });
    expect(first.approvalsRequested.some((a) => a.taskId === zoeTask.id)).toBe(true);
    expect((await ctx.store.tasks.get(zoeTask.id))!.status).toBe("todo"); // untouched

    const second = await runWorkCycle(ctx, { maxTasks: 10 });
    expect(second.approvalsRequested.filter((a) => a.taskId === zoeTask.id)).toHaveLength(0);
    expect(second.skipped.some((s) => s.reason === "awaiting_approval")).toBe(true);
  });

  it("budget-exhausted employees are skipped with the reason", async () => {
    await ctx.store.employees.update("emp_sales_director", { dailyTokenBudget: 1 });
    // Burn the budget with one chat.
    await app.request("/v1/employees/emp_sales_director/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "Quick status?" }),
    });
    const result = await runWorkCycle(ctx, { maxTasks: 10 });
    expect(result.skipped.some((s) => s.employeeId === "emp_sales_director" && s.reason === "budget_exhausted")).toBe(true);
  });

  it("the worker tick drives both workflows and the work cycle", async () => {
    const res = await app.request("/v1/worker/tick", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await res.json();
    expect(body.work).toBeDefined();
    expect(typeof body.work.scanned).toBe("number");
  });
});

describe("approval decisions drive autonomy", () => {
  async function queueForLegal() {
    return ctx.store.tasks.create({
      organizationId: SEED_ORG_ID,
      title: "Draft data processing addendum",
      description: "",
      status: "todo",
      priority: "normal",
      assignee: { kind: "employee", id: "emp_legal" },
      createdBy: { kind: "user", id: "usr_ceo" },
      labels: [],
    });
  }

  it("an approved request lets the low-autonomy employee work next cycle", async () => {
    const task = await queueForLegal();
    await runWorkCycle(ctx, { maxTasks: 10 }); // creates the approval
    const approval = (await ctx.store.approvals.list((a) => a.taskId === task.id))[0]!;
    await app.request(`/v1/approvals/${approval.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    const cycle = await runWorkCycle(ctx, { maxTasks: 10 });
    expect(cycle.completed.some((c) => c.taskId === task.id)).toBe(true);
    expect((await ctx.store.tasks.get(task.id))!.status).toBe("done");
  });

  it("a rejected request stands the task down", async () => {
    const task = await queueForLegal();
    await runWorkCycle(ctx, { maxTasks: 10 });
    const approval = (await ctx.store.approvals.list((a) => a.taskId === task.id))[0]!;
    await app.request(`/v1/approvals/${approval.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "rejected", reason: "Outside counsel handles this." }),
    });
    const cycle = await runWorkCycle(ctx, { maxTasks: 10 });
    expect(cycle.skipped.some((s) => s.taskId === task.id && s.reason === "approval_rejected")).toBe(true);
    expect((await ctx.store.tasks.get(task.id))!.status).toBe("cancelled");
  });
});
