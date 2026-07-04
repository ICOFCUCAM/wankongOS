import type { Kpi } from "./schemas.js";

export interface KpiReading {
  kpi: Kpi;
  value: number;
  /** Attainment in [0, ∞): 1.0 means the target was met exactly. */
  attainment: number;
  status: "exceeding" | "on_target" | "below";
}

/**
 * Evaluate a KPI against an observed value, honouring its direction. For
 * `higher_is_better` a value at/above target attains ≥1.0; for
 * `lower_is_better` a value at/below target attains ≥1.0. A zero target is
 * treated as met when the value matches its direction, avoiding divide-by-zero.
 */
export function evaluateKpi(kpi: Kpi, value: number): KpiReading {
  let attainment: number;
  if (kpi.direction === "higher_is_better") {
    attainment = kpi.target === 0 ? (value >= 0 ? 1 : 0) : value / kpi.target;
  } else {
    attainment = value === 0 ? (kpi.target >= 0 ? 1 : 0) : kpi.target / value;
  }
  attainment = Number.isFinite(attainment) ? Math.max(0, attainment) : 0;

  let status: KpiReading["status"];
  if (attainment >= 1.05) status = "exceeding";
  else if (attainment >= 0.95) status = "on_target";
  else status = "below";

  return { kpi, value, attainment, status };
}

/** Average attainment across a set of readings, in [0, ∞). */
export function overallAttainment(readings: KpiReading[]): number {
  if (readings.length === 0) return 0;
  const sum = readings.reduce((acc, r) => acc + r.attainment, 0);
  return sum / readings.length;
}
