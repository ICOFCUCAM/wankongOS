/**
 * The console's status color language (client-safe, no server imports).
 *
 * One place maps every derived presence state to its dot color, text tone,
 * and human label so cards, rollups, and panels always speak the same
 * visual language:
 *
 *   working        → green  (actively executing a task)
 *   thinking       → blue   (an AI response landed moments ago)
 *   waiting        → amber  (work queued, not started)
 *   needs_approval → orange (a human must approve something)
 *   blocked        → red    (a task it owns is stuck)
 *   learning       → purple (in training/probation)
 *   idle           → gray   (active but nothing assigned)
 *   offline        → dim    (paused or offboarded)
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
  thinking: { label: "Thinking", dot: "bg-info", text: "text-info", live: true },
  waiting: { label: "Waiting", dot: "bg-warn", text: "text-warn", live: false },
  needs_approval: { label: "Needs approval", dot: "bg-approval", text: "text-approval", live: true },
  blocked: { label: "Blocked", dot: "bg-danger", text: "text-danger", live: false },
  learning: { label: "Learning", dot: "bg-learning", text: "text-learning", live: true },
  idle: { label: "Idle", dot: "bg-muted", text: "text-muted", live: false },
  offline: { label: "Offline", dot: "bg-border", text: "text-muted", live: false },
};

export function activityStyle(status: string): ActivityStyle {
  return ACTIVITY_STYLES[status as ActivityStatus] ?? ACTIVITY_STYLES.idle;
}

/** Order used when rolling statuses up (most urgent first). */
export const ACTIVITY_ORDER: ActivityStatus[] = [
  "blocked",
  "needs_approval",
  "thinking",
  "working",
  "waiting",
  "learning",
  "idle",
  "offline",
];

/** Department glyph from its name — scanning aid, nothing more. */
export function deptEmoji(name: string): string {
  const n = name.toLowerCase();
  if (/exec/.test(n)) return "👔";
  if (/financ|account/.test(n)) return "💰";
  if (/sale/.test(n)) return "📈";
  if (/market|social|content/.test(n)) return "📣";
  if (/legal|compliance/.test(n)) return "⚖️";
  if (/engineer|tech|it/.test(n)) return "💻";
  if (/opera|procure|logisti/.test(n)) return "📦";
  if (/support|success|service/.test(n)) return "🎧";
  if (/hr|people|talent|recruit/.test(n)) return "🤝";
  if (/research|data/.test(n)) return "🔬";
  return "🏢";
}
