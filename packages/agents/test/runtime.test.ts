import { describe, expect, it } from "vitest";
import type { Employee } from "@wankong/core";
import {
  EmployeeRuntime,
  ProviderRegistry,
  buildSystemPrompt,
  drain,
  LocalProvider,
} from "@wankong/agents";

const employee: Employee = {
  id: "emp_sales",
  organizationId: "org_1",
  departmentId: "dept_sales",
  managerId: "emp_ceo",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  name: "Sam Rivera",
  title: "Sales Director",
  status: "active",
  description: "Owns revenue growth and the sales pipeline.",
  responsibilities: ["Qualify inbound leads", "Manage the pipeline"],
  objectives: ["Grow ARR by 30%"],
  kpis: [{ key: "arr", label: "ARR", target: 1_000_000, unit: "USD", direction: "higher_is_better" }],
  systemPrompt: "",
  temperature: 0.4,
  toolIds: [],
  permissions: ["employee:chat"],
  knowledgeBaseIds: [],
  escalationRules: [],
  approvalRules: [{ when: "discount exceeds 20%", requires: "task:approve" }],
  availability: { timezone: "UTC", alwaysOn: true },
};

describe("buildSystemPrompt", () => {
  it("includes identity, responsibilities, KPIs, and approval rules", () => {
    const prompt = buildSystemPrompt(employee, {
      organizationName: "Acme",
      departmentName: "Sales",
      managerName: "Root CEO",
    });
    expect(prompt).toContain("You are Sam Rivera, the Sales Director at Acme");
    expect(prompt).toContain("Qualify inbound leads");
    expect(prompt).toContain("ARR (target 1000000 USD)");
    expect(prompt).toContain("discount exceeds 20%");
    expect(prompt).toContain("Reports to: Root CEO");
  });
});

describe("LocalProvider", () => {
  it("streams a grounded, role-aware reply and reports usage", async () => {
    const result = await drain(new LocalProvider(), {
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(employee, { organizationName: "Acme" }),
        },
        { role: "user", content: "Can you approve a 30% discount for BigCo?" },
      ],
    });
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).toContain("Sales Director");
    // The ask trips an approval keyword, so governance notes must appear.
    expect(result.text.toLowerCase()).toContain("approval");
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.provider).toBe("local");
  });
});

describe("EmployeeRuntime + ProviderRegistry", () => {
  it("runs an employee end-to-end on the local provider by default", async () => {
    const runtime = new EmployeeRuntime(new ProviderRegistry());
    const result = await runtime.complete({
      employee,
      context: { organizationName: "Acme", departmentName: "Sales" },
      input: "Draft an outreach plan for Q3.",
    });
    expect(result.provider).toBe("local");
    expect(result.text).toContain("Sales Director");
    expect(result.finishReason).toBe("stop");
  });

  it("falls back to local when a pinned provider is unavailable", () => {
    const registry = new ProviderRegistry();
    expect(registry.get("anthropic").id).toBe("local");
    expect(registry.available()).toEqual(["local"]);
  });

  it("registers cloud providers when keys are present", () => {
    const registry = new ProviderRegistry({ anthropicApiKey: "sk-test" });
    expect(registry.has("anthropic")).toBe(true);
    expect(registry.get("anthropic").id).toBe("anthropic");
  });
});
