import { Hono } from "hono";
import { z } from "zod";
import { planPrune, rankMemories, scoreMemory } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize, findScoped, parseBody } from "../http.js";

const PruneInput = z.object({
  /** Highest-scoring memories to keep per owner. */
  capacity: z.number().int().min(1).max(1000).default(50),
});

export const memoryRoutes = new Hono<Env>();

/** An employee's memory timeline, ranked by salience (importance × recency). */
memoryRoutes.get("/employees/:id/memories", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const memories = await ctx.store.memories.list(
    (m) => m.organizationId === ctx.organizationId && m.ownerId === employee.id,
  );
  const now = new Date();
  return c.json({
    data: rankMemories(memories, { now }).map((m) => ({
      ...m,
      embedding: undefined,
      score: Math.round(scoreMemory(m, { now }) * 1000) / 1000,
    })),
  });
});

/**
 * Prune org memories: keep the top-`capacity` per owner, delete the rest.
 * Returns what was removed so the action is reviewable in the audit trail.
 */
memoryRoutes.post("/memories/prune", async (c) => {
  authorize(c, "org:manage");
  const ctx = c.get("ctx");
  const { capacity } = await parseBody(c, PruneInput);

  const memories = await ctx.store.memories.list(
    (m) => m.organizationId === ctx.organizationId,
  );
  const plan = planPrune(memories, capacity);
  for (const m of plan.prune) await ctx.store.memories.delete(m.id);

  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "memory.prune",
    metadata: { capacity, pruned: plan.prune.length, kept: plan.keep.length },
  });

  return c.json({ pruned: plan.prune.length, kept: plan.keep.length });
});
