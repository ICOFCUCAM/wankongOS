import { describe, expect, it } from "vitest";
import { buildOrgChart, flattenOrgChart, managementChain, type Employee } from "@wankong/core";

const base = {
  organizationId: "org_1",
  departmentId: "dept_1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  description: "",
  systemPrompt: "x",
  temperature: 0.4,
  responsibilities: [],
  objectives: [],
  kpis: [],
  toolIds: [],
  permissions: [],
  knowledgeBaseIds: [],
  escalationRules: [],
  approvalRules: [],
  status: "active" as const,
  availability: { timezone: "UTC", alwaysOn: true },
};

function emp(id: string, name: string, managerId?: string): Employee {
  return { ...base, id, name, title: name, managerId } as Employee;
}

describe("org chart", () => {
  const ceoAssistant = emp("emp_ea", "Ava EA", "emp_ceo");
  const ceo = emp("emp_ceo", "Root CEO");
  const sales = emp("emp_sales", "Sam Sales", "emp_ceo");
  const analyst = emp("emp_analyst", "Rae Research", "emp_sales");
  const all = [ceoAssistant, ceo, sales, analyst];

  it("nests reports under managers regardless of input order", () => {
    const roots = buildOrgChart(all);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.employee.id).toBe("emp_ceo");
    const reportIds = roots[0]!.reports.map((r) => r.employee.id).sort();
    expect(reportIds).toEqual(["emp_ea", "emp_sales"]);
  });

  it("flattens back to every employee", () => {
    expect(flattenOrgChart(buildOrgChart(all)).map((e) => e.id).sort()).toEqual(
      all.map((e) => e.id).sort(),
    );
  });

  it("computes the management chain up to the root", () => {
    expect(managementChain(all, "emp_analyst").map((e) => e.id)).toEqual([
      "emp_sales",
      "emp_ceo",
    ]);
  });

  it("does not hang or duplicate on a cycle", () => {
    const a = emp("emp_a", "A", "emp_b");
    const b = emp("emp_b", "B", "emp_a");
    const roots = buildOrgChart([a, b]);
    expect(flattenOrgChart(roots)).toHaveLength(2);
  });

  it("treats employees whose manager is outside the slice as roots", () => {
    const orphan = emp("emp_x", "X", "emp_missing");
    expect(buildOrgChart([orphan])).toHaveLength(1);
  });
});
