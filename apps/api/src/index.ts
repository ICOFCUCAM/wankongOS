/**
 * @wankong/api — the REST API for WankongOS.
 *
 * A Hono application exposing every core object over versioned `/v1` routes,
 * including buffered and streaming AI chat with employees. It is transport-only:
 * all domain logic lives in `@wankong/core`, all AI in `@wankong/agents`, and
 * all persistence in `@wankong/store`.
 */
export { createApp, type CreateAppOptions } from "./app.js";
export { createAppContext, type AppContext } from "./context.js";
export { runScheduledWorkflows, type TickResult } from "./scheduler.js";
export { runWorkCycle, type WorkCycleResult } from "./autonomy.js";
export type { EmployeeSummary } from "./routes/summaries.js";
export type { PulseItem } from "./routes/pulse.js";
export type { AnalyticsData, AnalyticsRow } from "./routes/analytics.js";
export type { Briefing } from "./routes/briefing.js";
export type {
  DepartmentHealth,
  DepartmentPulse,
  WorkforceHealth,
} from "./routes/workforce-health.js";
