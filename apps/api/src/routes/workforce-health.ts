import { Hono } from "hono";
import type { Env } from "../context.js";
import { authorize } from "../http.js";
import { computeWorkforceHealth, trendForOrg } from "../health.js";

export type { DepartmentHealth, DepartmentPulse, WorkforceHealth } from "../health.js";

export const workforceHealthRoutes = new Hono<Env>();

/**
 * The command center's header: one call answering "how is the company doing
 * right now?" — plus an honest trend that only appears once the worker tick
 * has recorded snapshot history (never an invented arrow).
 */
workforceHealthRoutes.get("/workforce/health", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const health = await computeWorkforceHealth(ctx.store, ctx.organizationId);
  const trend = await trendForOrg(ctx.store, ctx.organizationId, health.companyHealth.score);
  return c.json({ ...health, trend });
});
