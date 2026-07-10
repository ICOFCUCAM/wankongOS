import type { Approval, Employee, Task } from "./schemas.js";

/**
 * Live presence for an AI employee — the command center's core signal.
 *
 * Derived — never stored — from real records, so it can't drift from reality:
 *
 *   blocked         a task it owns is stuck (red)
 *   needs_approval  a human must approve something it requested (orange)
 *   thinking        an AI response landed moments ago — actively reasoning (blue)
 *   working         a task is in progress (green)
 *   waiting         work is queued (todo) but not started (yellow)
 *   learning        on probation / in training (purple)
 *   idle            active, nothing assigned (gray)
 *   offline         paused or offboarded (dim)
 */
export type ActivityStatus =
  | "working"
  | "waiting"
  | "needs_approval"
  | "thinking"
  | "blocked"
  | "learning"
  | "idle"
  | "offline";

/** Most-urgent-first, for rollups and sorting. */
export const ACTIVITY_STATUS_ORDER: ActivityStatus[] = [
  "blocked",
  "needs_approval",
  "thinking",
  "working",
  "waiting",
  "learning",
  "idle",
  "offline",
];

/** How recently an assistant message must have landed to count as "thinking". */
export const THINKING_WINDOW_MS = 120_000;

export interface ActivityInput {
  /** Tasks assigned to the employee. */
  tasks: Task[];
  /** Approvals requested by the employee that are still pending. */
  pendingApprovals: Approval[];
  /** Timestamp of the employee's latest assistant message, if any. */
  lastAssistantAt?: string;
  /** "Now" for the thinking window (injectable for tests). Defaults to Date.now(). */
  now?: number;
}

export function deriveActivityStatus(employee: Employee, input: ActivityInput): ActivityStatus {
  if (employee.status === "paused" || employee.status === "offboarded") return "offline";
  if (employee.status === "training") return "learning";

  const open = input.tasks.filter((t) => !["done", "cancelled"].includes(t.status));
  if (open.some((t) => t.status === "blocked")) return "blocked";
  if (input.pendingApprovals.length > 0 || open.some((t) => t.status === "awaiting_approval")) {
    return "needs_approval";
  }
  if (input.lastAssistantAt) {
    const now = input.now ?? Date.now();
    const at = Date.parse(input.lastAssistantAt);
    if (Number.isFinite(at) && now - at >= 0 && now - at < THINKING_WINDOW_MS) return "thinking";
  }
  if (open.some((t) => t.status === "in_progress")) return "working";
  if (open.some((t) => t.status === "todo")) return "waiting";
  return "idle";
}

/** The task an employee is visibly "working on" right now, if any. */
export function currentTask(tasks: Task[]): Task | undefined {
  return tasks
    .filter((t) => t.status === "in_progress")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
