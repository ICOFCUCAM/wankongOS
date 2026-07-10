import { Hono } from "hono";
import type { Env } from "../context.js";
import { authorize } from "../http.js";
import { runScheduledWorkflows } from "../scheduler.js";
import { runWorkCycle } from "../autonomy.js";
import { recordHealthSnapshot } from "../health.js";

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
  const work = await runWorkCycle(ctx);
  const healthSnapshot = await recordHealthSnapshot(ctx.store, ctx.organizationId);
  return c.json({ ...result, work, healthSnapshot });
});

/**
 * Cron-friendly GET tick (Vercel Cron sends GET). When CRON_SECRET is set,
 * the request must carry `Authorization: Bearer <CRON_SECRET>` (Vercel's
 * convention); without one it falls back to the normal permission check.
 */
workerRoutes.get("/worker/tick", async (c) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const given = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (given !== secret) return c.json({ error: "Invalid cron secret" }, 401);
  } else {
    authorize(c, "workflow:run");
  }
  const ctx = c.get("ctx");
  const result = await runScheduledWorkflows(ctx);
  const work = await runWorkCycle(ctx);
  const healthSnapshot = await recordHealthSnapshot(ctx.store, ctx.organizationId);
  return c.json({ ...result, work, healthSnapshot });
});
