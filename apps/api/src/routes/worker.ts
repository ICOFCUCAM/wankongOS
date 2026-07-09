import { Hono } from "hono";
import type { Env } from "../context.js";
import { authorize } from "../http.js";
import { runScheduledWorkflows } from "../scheduler.js";

export const workerRoutes = new Hono<Env>();

/**
 * The scheduler tick. Idempotent per minute — drive it from `apps/worker`,
 * a platform cron (e.g. Vercel Cron hitting this route every minute), or by
 * hand. Requires workflow:run; use a scoped API key for platform crons.
 */
workerRoutes.post("/worker/tick", async (c) => {
  authorize(c, "workflow:run");
  const ctx = c.get("ctx");
  const result = await runScheduledWorkflows(ctx);
  return c.json(result);
});
