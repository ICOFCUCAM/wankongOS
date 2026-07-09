import { describe, expect, it } from "vitest";
import { EmployeeRuntime, ProviderRegistry } from "@wankong/agents";
import { runSuite } from "@wankong/evals";
import { buildSeedData, buildSeedEvalSuites } from "@wankong/store";

const runtime = new EmployeeRuntime(new ProviderRegistry());
const employees = buildSeedData().employees;
const suites = buildSeedEvalSuites();

function employee(id: string) {
  const found = employees.find((e) => e.id === id);
  if (!found) throw new Error(`missing seed employee ${id}`);
  return found;
}

describe("eval runner", () => {
  it("passes both seeded suites against their seeded employees", async () => {
    for (const suite of suites) {
      const outcome = await runSuite({
        runtime,
        employee: employee(suite.employeeId),
        context: { organizationName: "Acme Robotics" },
        suite,
        now: () => 0,
      });
      expect(outcome.pass, `${suite.name} should pass`).toBe(true);
      expect(outcome.passedTasks).toBe(outcome.totalTasks);
    }
  });

  it("fails when the employee is edited out of its role (the regression the gate catches)", async () => {
    const suite = suites.find((s) => s.id === "evs_support")!;
    const broken = {
      ...employee("emp_support_manager"),
      title: "Landscape Gardener",
      responsibilities: ["Mow the lawns", "Trim the hedges"],
      objectives: ["Perfect stripes on every lawn"],
    };
    const outcome = await runSuite({
      runtime,
      employee: broken,
      context: { organizationName: "Acme Robotics" },
      suite,
      now: () => 0,
    });
    expect(outcome.pass).toBe(false);
    const sla = outcome.results.find((r) => r.taskId === "sla-discipline")!;
    expect(sla.pass).toBe(false);
    expect(sla.checks.some((c) => c.detail?.includes("SLA"))).toBe(true);
  });

  it("reports per-check detail for failures", async () => {
    const suite = {
      ...suites[0]!,
      tasks: [
        {
          id: "impossible",
          name: "Impossible check",
          input: "Say hello.",
          checks: [{ kind: "contains" as const, value: "xyzzy-never-appears", caseSensitive: false }],
        },
      ],
    };
    const outcome = await runSuite({
      runtime,
      employee: employee("emp_support_manager"),
      context: { organizationName: "Acme Robotics" },
      suite,
      now: () => 0,
    });
    expect(outcome.pass).toBe(false);
    expect(outcome.results[0]!.checks[0]!.detail).toContain("xyzzy-never-appears");
    expect(outcome.results[0]!.replyPreview.length).toBeGreaterThan(0);
  });
});
