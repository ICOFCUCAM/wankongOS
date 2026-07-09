import { describe, expect, it } from "vitest";
import type { Employee } from "@wankong/core";
import { EmployeeRuntime, ProviderRegistry, ToolRegistry } from "@wankong/agents";

function employee(over: Partial<Employee> = {}): Employee {
  return {
    id: "emp_t",
    organizationId: "org_1",
    departmentId: "dept_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    name: "Toolie",
    title: "Operations Manager",
    status: "active",
    description: "Runs ops.",
    responsibilities: [],
    objectives: [],
    kpis: [],
    systemPrompt: "",
    temperature: 0.3,
    toolIds: ["echo.run"],
    permissions: ["task:create"],
    knowledgeBaseIds: [],
    escalationRules: [],
    approvalRules: [],
    availability: { timezone: "UTC", alwaysOn: true },
    ...over,
  };
}

function makeRegistry(requires?: string) {
  const calls: Record<string, unknown>[] = [];
  const registry = new ToolRegistry();
  registry.register("echo.run", {
    definition: {
      name: "echo.run",
      description: "Echo test tool.",
      parameters: { type: "object", properties: { text: { type: "string" } } },
      triggers: ["\\becho\\b"],
    },
    requires,
    async run(args) {
      calls.push(args);
      return `echoed: ${String(args.text)}`;
    },
  });
  return { registry, calls };
}

const runtime = new EmployeeRuntime(new ProviderRegistry());

describe("agent tool loop (local provider)", () => {
  it("calls a triggered tool and grounds the final reply in its result", async () => {
    const { registry, calls } = makeRegistry();
    const result = await runtime.complete({
      employee: employee(),
      context: { organizationName: "Acme" },
      input: "Please echo this important message.",
      tools: {
        registry,
        context: { organizationId: "org_1", employeeId: "emp_t", permissions: ["task:create"] },
      },
    });
    expect(calls).toHaveLength(1);
    expect(result.executedTools).toHaveLength(1);
    expect(result.executedTools[0]!.ok).toBe(true);
    expect(result.text).toContain("echoed: Please echo this important message.");
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it("does not call tools when no trigger matches", async () => {
    const { registry, calls } = makeRegistry();
    const result = await runtime.complete({
      employee: employee(),
      context: { organizationName: "Acme" },
      input: "Summarise the Q3 pipeline for me.",
      tools: {
        registry,
        context: { organizationId: "org_1", employeeId: "emp_t", permissions: [] },
      },
    });
    expect(calls).toHaveLength(0);
    expect(result.executedTools).toHaveLength(0);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("surfaces permission denials as failed tool results, not crashes", async () => {
    const { registry, calls } = makeRegistry("task:approve");
    const result = await runtime.complete({
      employee: employee({ permissions: ["employee:chat"] }),
      context: { organizationName: "Acme" },
      input: "echo something",
      tools: {
        registry,
        context: { organizationId: "org_1", employeeId: "emp_t", permissions: ["employee:chat"] },
      },
    });
    expect(calls).toHaveLength(0);
    expect(result.executedTools[0]!.ok).toBe(false);
    expect(result.executedTools[0]!.result).toContain("task:approve");
  });

  it("offers only tools in the employee's toolIds", async () => {
    const { registry, calls } = makeRegistry();
    const result = await runtime.complete({
      employee: employee({ toolIds: [] }),
      context: { organizationName: "Acme" },
      input: "echo something",
      tools: {
        registry,
        context: { organizationId: "org_1", employeeId: "emp_t", permissions: [] },
      },
    });
    expect(calls).toHaveLength(0);
    expect(result.executedTools).toHaveLength(0);
  });
});
