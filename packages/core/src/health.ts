import { z } from "zod";

const Id = z.string().min(1).max(80);
const Timestamp = z.string().datetime();

/**
 * A point-in-time record of the company-health score and its disclosed
 * inputs. Snapshots are written by the worker tick (throttled), which makes
 * the dashboard trend HONEST: it compares two stored measurements instead of
 * inventing a direction. No snapshots yet → no trend shown (ADR-0018).
 */
export const HealthSnapshot = z.object({
  id: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  organizationId: Id,
  /** When the measurement was taken (same as createdAt for live recordings). */
  at: Timestamp,
  /** The 0–100 score from the disclosed workforce-health formula. */
  score: z.number().min(0).max(100),
  inputs: z.object({
    availability: z.number(),
    flow: z.number(),
    approvalLoad: z.number(),
    confidence: z.number(),
  }),
  employees: z.number().int().min(0),
  activeTasks: z.number().int().min(0),
  pendingApprovals: z.number().int().min(0),
  completedToday: z.number().int().min(0),
});
export type HealthSnapshot = z.infer<typeof HealthSnapshot>;

/** Trend derived from two stored snapshots — null whenever history is missing. */
export interface HealthTrend {
  deltaScore: number;
  baselineScore: number;
  baselineAt: string;
  /** Whole hours between the baseline snapshot and now. */
  hoursAgo: number;
  basis: string;
}

/**
 * Pick the trend baseline: the OLDEST snapshot taken within the last
 * `windowHours` (default 24h) that is at least `minAgeMinutes` old. Returns
 * null when history is too thin — the console then shows no arrow at all
 * rather than a made-up one.
 */
export function healthTrend(
  snapshots: Pick<HealthSnapshot, "at" | "score">[],
  currentScore: number,
  now: Date = new Date(),
  windowHours = 24,
  minAgeMinutes = 60,
): HealthTrend | null {
  const nowMs = now.getTime();
  const eligible = snapshots
    .filter((s) => {
      const age = nowMs - new Date(s.at).getTime();
      return age >= minAgeMinutes * 60_000 && age <= windowHours * 3_600_000;
    })
    .sort((a, b) => a.at.localeCompare(b.at));
  const baseline = eligible[0];
  if (!baseline) return null;
  const hoursAgo = Math.round((nowMs - new Date(baseline.at).getTime()) / 3_600_000);
  return {
    deltaScore: Math.round(currentScore - baseline.score),
    baselineScore: baseline.score,
    baselineAt: baseline.at,
    hoursAgo,
    basis: `current score minus the snapshot recorded ${hoursAgo}h ago by the worker tick — two stored measurements, nothing inferred`,
  };
}
