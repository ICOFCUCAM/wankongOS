import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry, buildSystemPrompt } from "@wankong/agents";
import { LocalEmbedder } from "@wankong/knowledge";
import { createApp } from "../src/app.js";
import { createAppContext, type AppContext } from "../src/context.js";
import { buildGroundedEmployeeContext } from "../src/employee-context.js";
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

describe("the work timeline (ADR-0027)", () => {
  it("assembles evidence-linked items from real records, newest first", async () => {
    await runWorkCycle(ctx, { maxTasks: 5 }); // sales director completes the seeded todo
    const res = await app.request("/v1/employees/emp_sales_director/timeline");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2); // completion + conversation at least

    const done = data.find((i: { kind: string }) => i.kind === "task_done");
    expect(done.text).toContain("outreach");
    expect(done.ref.type).toBe("task");
    expect(done.ref.id.startsWith("task_")).toBe(true);

    const convo = data.find((i: { kind: string }) => i.kind === "conversation");
    expect(convo.text).toContain("Task:");

    const times = data.map((i: { at: string }) => i.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("includes checkpoint steps as individual evidence lines", async () => {
    const seeded = await ctx.store.tasks.list((t) => t.status === "todo");
    for (const t of seeded) await ctx.store.tasks.update(t.id, { status: "cancelled" });
    await ctx.store.tasks.create({
      organizationId: SEED_ORG_ID, title: "Two-part brief", description: "", status: "todo",
      priority: "normal", assignee: { kind: "employee", id: "emp_sales_director" },
      createdBy: { kind: "user", id: "usr_ceo" }, labels: [],
      checkpoint: { steps: ["Gather inputs", "Write brief"], completed: 0, notes: [] },
    });
    await runWorkCycle(ctx, { maxTasks: 5 });
    const { data } = await (await app.request("/v1/employees/emp_sales_director/timeline")).json();
    const step = data.find((i: { kind: string }) => i.kind === "task_step");
    expect(step.text).toContain("Step 1/2");
    expect(step.text).toContain("Gather inputs");
  });
});

describe("explainability: the activity log reaches the prompt", () => {
  it("grounds chat with the employee's own timestamped acts", async () => {
    await runWorkCycle(ctx, { maxTasks: 5 });
    const employee = (await ctx.store.employees.get("emp_sales_director"))!;
    const grounded = await buildGroundedEmployeeContext(ctx.store, SEED_ORG_ID, employee);
    expect(grounded.context.activityLog!.length).toBeGreaterThanOrEqual(1);
    expect(grounded.context.activityLog!.join("\n")).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] Completed/);

    const prompt = buildSystemPrompt(employee, grounded.context);
    expect(prompt).toContain("recent activity log");
    expect(prompt).toContain("cite timestamps");
  });
});
