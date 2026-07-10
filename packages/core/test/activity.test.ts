import { describe, expect, it } from "vitest";
import { currentTask, deriveActivityStatus, type Employee, type Task } from "@wankong/core";

const emp = (status: Employee["status"]): Employee =>
  ({
    id: "emp_1", organizationId: "org_1", departmentId: "dept_1",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    name: "E", title: "T", status, description: "", systemPrompt: "x", temperature: 0.4,
    responsibilities: [], objectives: [], kpis: [], toolIds: [], permissions: [],
    knowledgeBaseIds: [], escalationRules: [], approvalRules: [],
    availability: { timezone: "UTC", alwaysOn: true },
  }) as Employee;

const task = (status: Task["status"], updatedAt = "2026-01-02T00:00:00.000Z"): Task =>
  ({
    id: `task_${status}_${updatedAt}`, organizationId: "org_1", title: "t", description: "",
    status, priority: "normal", createdBy: { kind: "user", id: "u" }, labels: [],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt,
  }) as Task;

describe("activity status derivation", () => {
  it("maps lifecycle to offline/learning", () => {
    expect(deriveActivityStatus(emp("paused"), { tasks: [], pendingApprovals: [] })).toBe("offline");
    expect(deriveActivityStatus(emp("training"), { tasks: [], pendingApprovals: [] })).toBe("learning");
  });

  it("blocked > needs_approval > thinking > working > waiting > idle precedence", () => {
    expect(
      deriveActivityStatus(emp("active"), { tasks: [task("blocked"), task("in_progress")], pendingApprovals: [] }),
    ).toBe("blocked");
    expect(
      deriveActivityStatus(emp("active"), { tasks: [task("awaiting_approval")], pendingApprovals: [] }),
    ).toBe("needs_approval");
    expect(deriveActivityStatus(emp("active"), { tasks: [task("in_progress")], pendingApprovals: [] })).toBe("working");
    expect(deriveActivityStatus(emp("active"), { tasks: [task("todo")], pendingApprovals: [] })).toBe("waiting");
    expect(deriveActivityStatus(emp("active"), { tasks: [task("done")], pendingApprovals: [] })).toBe("idle");
  });

  it("thinking: a fresh assistant message wins over working, and expires", () => {
    const now = Date.parse("2026-01-02T00:10:00.000Z");
    const fresh = "2026-01-02T00:09:30.000Z"; // 30s ago
    const stale = "2026-01-02T00:05:00.000Z"; // 5m ago
    expect(
      deriveActivityStatus(emp("active"), {
        tasks: [task("in_progress")], pendingApprovals: [], lastAssistantAt: fresh, now,
      }),
    ).toBe("thinking");
    expect(
      deriveActivityStatus(emp("active"), {
        tasks: [task("in_progress")], pendingApprovals: [], lastAssistantAt: stale, now,
      }),
    ).toBe("working");
    // Urgent states still outrank thinking.
    expect(
      deriveActivityStatus(emp("active"), {
        tasks: [task("blocked")], pendingApprovals: [], lastAssistantAt: fresh, now,
      }),
    ).toBe("blocked");
  });

  it("currentTask picks the most recently touched in-progress task", () => {
    const older = task("in_progress", "2026-01-02T00:00:00.000Z");
    const newer = task("in_progress", "2026-01-03T00:00:00.000Z");
    expect(currentTask([older, newer, task("todo")])?.id).toBe(newer.id);
    expect(currentTask([task("todo")])).toBeUndefined();
  });
});
