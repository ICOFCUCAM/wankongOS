import type { Approval, Employee, Task } from "./schemas.js";

/**
 * Live activity status for an AI employee (Problem 6 of the console redesign).
 *
 * Derived — never stored — from real records, so it can't drift from reality:
 * lifecycle status maps to offline/learning; an active employee is `blocked`
 * if any of its tasks are blocked, `waiting` if it has approvals pending a
 * human, `working` if it has tasks in progress, otherwise `idle`.
 */
export type ActivityStatus = "working" | "waiting" | "blocked" | "learning" | "idle" | "offline";

export const ACTIVITY_STATUS_ORDER: ActivityStatus[] = [
  "blocked",
  "waiting",
  "working",
  "idle",
  "learning",
  "offline",
];

export interface ActivityInput {
  /** Tasks assigned to the employee. */
  tasks: Task[];
  /** Approvals requested by the employee that are still pending. */
  pendingApprovals: Approval[];
}

export function deriveActivityStatus(employee: Employee, input: ActivityInput): ActivityStatus {
  if (employee.status === "paused" || employee.status === "offboarded") return "offline";
  if (employee.status === "training") return "learning";

  const open = input.tasks.filter((t) => !["done", "cancelled"].includes(t.status));
  if (open.some((t) => t.status === "blocked")) return "blocked";
  if (input.pendingApprovals.length > 0 || open.some((t) => t.status === "awaiting_approval")) {
    return "waiting";
  }
  if (open.some((t) => t.status === "in_progress")) return "working";
  return "idle";
}

/** The task an employee is visibly "working on" right now, if any. */
export function currentTask(tasks: Task[]): Task | undefined {
  return tasks
    .filter((t) => t.status === "in_progress")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
