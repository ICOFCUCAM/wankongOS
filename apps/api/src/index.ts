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
