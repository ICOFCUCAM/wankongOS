import { describe, expect, it } from "vitest";
import { Employee } from "@wankong/core";
import { buildSeedData, createSeededStore, SEED_ORG_ID } from "@wankong/store";

describe("seed organization", () => {
  it("defines exactly 11 valid AI employees across 10 departments", () => {
    const data = buildSeedData();
    expect(data.employees).toHaveLength(11);
    expect(data.departments).toHaveLength(10);
    // Every employee must satisfy the domain schema.
    for (const e of data.employees) expect(() => Employee.parse(e)).not.toThrow();
  });

  it("wires managers into a connected hierarchy", () => {
    const data = buildSeedData();
    const ids = new Set(data.employees.map((e) => e.id));
    const withManager = data.employees.filter((e) => e.managerId);
    expect(withManager.length).toBeGreaterThan(0);
    for (const e of withManager) expect(ids.has(e.managerId!)).toBe(true);
  });

  it("gives every employee governance: KPIs and at least one rule or objective", () => {
    for (const e of buildSeedData().employees) {
      expect(e.kpis.length).toBeGreaterThan(0);
      expect(e.objectives.length + e.approvalRules.length + e.escalationRules.length).toBeGreaterThan(0);
      expect(e.permissions).toContain("employee:chat");
    }
  });

  it("loads into a store and builds an org chart reaching every employee", async () => {
    const store = createSeededStore();
    expect(await store.employees.count()).toBe(11);
    const chart = await store.orgChart(SEED_ORG_ID);
    const count = (nodes: Awaited<ReturnType<typeof store.orgChart>>): number =>
      nodes.reduce((n, node) => n + 1 + count(node.reports), 0);
    expect(count(chart)).toBe(11);
    expect(await store.goals.count()).toBe(3);
    expect(await store.tasks.count()).toBe(3);
  });
});
