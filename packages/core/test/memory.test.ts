import { describe, expect, it } from "vitest";
import { planPrune, rankMemories, scoreMemory, type Memory } from "@wankong/core";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function mem(over: Partial<Memory>): Memory {
  return {
    id: `mem_${Math.random().toString(36).slice(2, 8)}`,
    organizationId: "org_1",
    scope: "employee",
    kind: "fact",
    ownerId: "emp_1",
    content: "x",
    importance: 0.5,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...over,
  };
}

describe("memory scoring", () => {
  it("decays with age at the configured half-life", () => {
    const fresh = mem({ createdAt: NOW.toISOString(), importance: 1 });
    const monthOld = mem({ createdAt: "2026-05-02T00:00:00.000Z", importance: 1 });
    expect(scoreMemory(fresh, { now: NOW })).toBeCloseTo(1, 2);
    expect(scoreMemory(monthOld, { now: NOW, halfLifeDays: 30 })).toBeCloseTo(0.5, 1);
  });

  it("access refreshes recency", () => {
    const stale = mem({ createdAt: "2026-01-01T00:00:00.000Z", importance: 1 });
    const accessed = mem({
      createdAt: "2026-01-01T00:00:00.000Z",
      lastAccessedAt: NOW.toISOString(),
      importance: 1,
    });
    expect(scoreMemory(accessed, { now: NOW })).toBeGreaterThan(scoreMemory(stale, { now: NOW }));
  });

  it("ranks by combined importance and recency", () => {
    const important = mem({ importance: 0.9, createdAt: "2026-05-30T00:00:00.000Z" });
    const trivial = mem({ importance: 0.1, createdAt: "2026-05-30T00:00:00.000Z" });
    const ranked = rankMemories([trivial, important], { now: NOW });
    expect(ranked[0]!.id).toBe(important.id);
  });
});

describe("memory pruning", () => {
  it("keeps the top N per owner and marks the rest", () => {
    const memories = [
      mem({ ownerId: "emp_1", importance: 0.9 }),
      mem({ ownerId: "emp_1", importance: 0.5 }),
      mem({ ownerId: "emp_1", importance: 0.1 }),
      mem({ ownerId: "emp_2", importance: 0.2 }),
    ];
    const plan = planPrune(memories, 2, { now: NOW });
    expect(plan.keep).toHaveLength(3); // 2 for emp_1, 1 for emp_2
    expect(plan.prune).toHaveLength(1);
    expect(plan.prune[0]!.importance).toBe(0.1);
  });
});
