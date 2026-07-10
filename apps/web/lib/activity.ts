/**
 * The console's status color language (client-safe, no server imports).
 *
 * One place maps every derived activity state to its dot color, text tone,
 * and human label so cards, org chart, and department rollups always speak
 * the same visual language:
 *
 *   working  → green (actively executing a task)
 *   waiting  → amber (blocked on a human approval)
 *   blocked  → red   (a task it owns is stuck)
 *   learning → blue  (in training/probation)
 *   idle     → gray  (active but nothing in progress)
 *   offline  → dim   (paused or offboarded)
 */
export type ActivityStatus = "working" | "waiting" | "blocked" | "learning" | "idle" | "offline";

export interface ActivityStyle {
  label: string;
  /** Tailwind classes for the status dot. */
  dot: string;
  /** Tailwind classes for status text. */
  text: string;
  /** Whether the dot should pulse (something is happening right now). */
  live: boolean;
}

export const ACTIVITY_STYLES: Record<ActivityStatus, ActivityStyle> = {
  working: { label: "Working", dot: "bg-success", text: "text-success", live: true },
  waiting: { label: "Waiting on approval", dot: "bg-warn", text: "text-warn", live: true },
  blocked: { label: "Blocked", dot: "bg-danger", text: "text-danger", live: false },
  learning: { label: "Learning", dot: "bg-info", text: "text-info", live: true },
  idle: { label: "Idle", dot: "bg-muted", text: "text-muted", live: false },
  offline: { label: "Offline", dot: "bg-border", text: "text-muted", live: false },
};

export function activityStyle(status: string): ActivityStyle {
  return ACTIVITY_STYLES[status as ActivityStatus] ?? ACTIVITY_STYLES.idle;
}

/** Order used when rolling statuses up (most urgent first). */
export const ACTIVITY_ORDER: ActivityStatus[] = [
  "blocked",
  "waiting",
  "working",
  "learning",
  "idle",
  "offline",
];
