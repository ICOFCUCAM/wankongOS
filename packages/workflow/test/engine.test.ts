import { beforeEach, describe, expect, it } from "vitest";
import type { Employee } from "@wankong/core";
import { EmployeeRuntime, ProviderRegistry, type PromptContext } from "@wankong/agents";
import {
  WorkflowEngine,
  buildSeedWorkflow,
  defaultConnectors,
  type EngineDeps,
  type NotificationPayload,
} from "@wankong/workflow";

function employee(id: string, title: string): Employee {
  return {
    id,
    organizationId: "org_acme",
    departmentId: "dept_x",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    name: `${title} Bot`,
    title,
    status: "active",
    description: `A ${title}.`,
    responsibilities: [],
    objectives: [],
    kpis: [],
    systemPrompt: "",
    temperature: 0.3,
    toolIds: [],
    permissions: ["employee:chat"],
    knowledgeBaseIds: [],
    escalationRules: [],
    approvalRules: [],
    availability: { timezone: "UTC", alwaysOn: true },
  };
}

describe("WorkflowEngine", () => {
  let notifications: NotificationPayload[];
  let approvals: { summary: string; runId: string }[];
  let stepCounter: number;
  let clockTick: number;
  let deps: EngineDeps;

  const context: PromptContext = { organizationName: "Acme" };

  beforeEach(() => {
    notifications = [];
    approvals = [];
    stepCounter = 0;
    clockTick = 0;
    deps = {
      runtime: new EmployeeRuntime(new ProviderRegistry()),
      connectors: defaultConnectors(),
      resolveEmployee: async (id) => {
        if (id === "emp_research") return { employee: employee(id, "Research Analyst"), context };
        if (id === "emp_sales_director") return { employee: employee(id, "Sales Director"), context };
        return null;
      },
      createApproval: async ({ summary, runId }) => {
        approvals.push({ summary, runId });
        return `appr_${approvals.length}`;
      },
      emitNotification: async (p) => {
        notifications.push(p);
      },
      clock: () => `2026-01-01T00:00:${String(clockTick++).padStart(2, "0")}.000Z`,
      newStepId: () => `step_${++stepCounter}`,
    };
  });

  it("pauses at approval for a high-score lead, then completes when approved", async () => {
    const engine = new WorkflowEngine(deps);
    const wf = buildSeedWorkflow("org_acme");

    let run = await engine.start(wf, { lead: { name: "Dana", company: "BigCo", score: 85 } }, { kind: "system", id: "trigger" }, "run_1");

    // It ran research + draft, then paused for approval.
    expect(run.status).toBe("paused");
    expect(run.pendingApprovalId).toBe("appr_1");
    expect(run.currentNodeId).toBe("n_approval");
    expect(typeof run.context.brief).toBe("string");
    expect(typeof run.context.draft).toBe("string");
    expect(approvals[0]!.summary).toContain("BigCo");

    run = await engine.resume(wf, run, "approved");

    expect(run.status).toBe("completed");
    // CRM connector ran and notification fired.
    expect((run.context.crm as { status: string }).status).toBe("queued");
    expect(notifications.at(-1)!.message).toContain("BigCo");
    // Every step is resolved (no lingering running/paused).
    expect(run.steps.every((s) => s.status === "succeeded")).toBe(true);
  });

  it("routes low-score leads straight to nurture without approval", async () => {
    const engine = new WorkflowEngine(deps);
    const wf = buildSeedWorkflow("org_acme");
    const run = await engine.start(wf, { lead: { name: "Sam", company: "SmallCo", score: 30 } }, { kind: "system", id: "trigger" }, "run_2");

    expect(run.status).toBe("completed");
    expect(approvals).toHaveLength(0);
    expect(notifications[0]!.message).toContain("nurture");
    expect(run.context.draft).toBeUndefined();
  });

  it("routes to nurture when the approval is rejected", async () => {
    const engine = new WorkflowEngine(deps);
    const wf = buildSeedWorkflow("org_acme");
    let run = await engine.start(wf, { lead: { name: "Dana", company: "BigCo", score: 90 } }, { kind: "system", id: "trigger" }, "run_3");
    expect(run.status).toBe("paused");

    run = await engine.resume(wf, run, "rejected");
    expect(run.status).toBe("completed");
    expect(run.context["approval:n_approval"]).toBe("rejected");
    expect(notifications.at(-1)!.message).toContain("nurture");
  });

  it("fails a run when an employee cannot be resolved", async () => {
    const engine = new WorkflowEngine({
      ...deps,
      resolveEmployee: async () => null,
    });
    const wf = buildSeedWorkflow("org_acme");
    const run = await engine.start(wf, { lead: { name: "X", company: "Y", score: 99 } }, { kind: "system", id: "t" }, "run_4");
    expect(run.status).toBe("failed");
    expect(run.error).toContain("Employee not found");
  });

  it("guards against infinite loops with a step ceiling", async () => {
    const engine = new WorkflowEngine({ ...deps, maxSteps: 5 });
    // A definition that loops forever: start → decision(always true → start).
    const looping = {
      id: "wf_loop",
      organizationId: "org_acme",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      name: "Loop",
      trigger: { kind: "manual" as const },
      entryNodeId: "s",
      active: true,
      nodes: [
        { id: "s", type: "start" as const, next: "d" },
        {
          id: "d",
          type: "decision" as const,
          branches: [{ when: { path: "x", op: "eq" as const, value: undefined }, to: "s" }],
          else: "e",
        },
        { id: "e", type: "end" as const, status: "completed" as const },
      ],
    };
    const run = await engine.start(looping, {}, { kind: "system", id: "t" }, "run_5");
    expect(run.status).toBe("failed");
    expect(run.error).toContain("Maximum step count");
  });
});
