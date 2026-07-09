/**
 * @wankong/workflow — the workflow execution engine.
 *
 * Interprets `Workflow` definitions from `@wankong/core`, driving runs through
 * employee steps, decisions, parallel branches, connector calls, notifications,
 * and human approvals (which pause and resume). Pure orchestration: persistence
 * and side effects are injected, so the same engine runs in tests, the API, and
 * a future background worker unchanged.
 */
export * from "./connectors.js";
export * from "./engine.js";
export * from "./seed-workflow.js";
