import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { createApp } from "../src/app.js";
import { createAppContext, type AppContext } from "../src/context.js";

let ctx: AppContext;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  ctx = createAppContext({
    store: createSeededStore(),
    registry: new ProviderRegistry(),
    organizationId: SEED_ORG_ID,
  });
  app = createApp({ context: ctx, quiet: true });
  await ctx.ready;
});

const tick = () =>
  app.request("/v1/worker/tick", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

describe("health history (honest trend)", () => {
  it("shows NO trend until snapshot history exists — never an invented arrow", async () => {
    const h = await (await app.request("/v1/workforce/health")).json();
    expect(h.trend).toBeNull();
    expect(h.companyHealth.score).toBeGreaterThan(0);
  });

  it("records a snapshot on the worker tick, throttled to ~20 minutes", async () => {
    const first = await (await tick()).json();
    expect(first.healthSnapshot.recorded).toBe(true);
    expect(first.healthSnapshot.score).toBeGreaterThanOrEqual(0);

    const snapshots = await ctx.store.healthSnapshots.listByOrg(SEED_ORG_ID);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.inputs).toHaveProperty("availability");

    // An immediate second tick is throttled — no snapshot spam from a per-minute cron.
    const second = await (await tick()).json();
    expect(second.healthSnapshot.recorded).toBe(false);
    expect(await ctx.store.healthSnapshots.listByOrg(SEED_ORG_ID)).toHaveLength(1);

    // A minutes-old snapshot is still too fresh to be a trend baseline.
    const h = await (await app.request("/v1/workforce/health")).json();
    expect(h.trend).toBeNull();
  });

  it("derives the trend from two stored measurements once history is old enough", async () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3_600_000).toISOString();
    await ctx.store.healthSnapshots.create({
      organizationId: SEED_ORG_ID,
      at: fiveHoursAgo,
      score: 50,
      inputs: { availability: 0.5, flow: 0.5, approvalLoad: 0.5, confidence: 0.5 },
      employees: 10,
      activeTasks: 5,
      pendingApprovals: 1,
      completedToday: 2,
    });

    const h = await (await app.request("/v1/workforce/health")).json();
    expect(h.trend).not.toBeNull();
    expect(h.trend.baselineScore).toBe(50);
    expect(h.trend.baselineAt).toBe(fiveHoursAgo);
    expect(h.trend.hoursAgo).toBe(5);
    expect(h.trend.deltaScore).toBe(Math.round(h.companyHealth.score - 50));
    expect(h.trend.basis).toContain("two stored measurements");
  });

  it("ignores snapshots outside the 24h comparison window", async () => {
    await ctx.store.healthSnapshots.create({
      organizationId: SEED_ORG_ID,
      at: new Date(Date.now() - 48 * 3_600_000).toISOString(),
      score: 10,
      inputs: { availability: 0.1, flow: 0.1, approvalLoad: 0.1, confidence: 0.1 },
      employees: 10,
      activeTasks: 5,
      pendingApprovals: 1,
      completedToday: 0,
    });
    const h = await (await app.request("/v1/workforce/health")).json();
    expect(h.trend).toBeNull();
  });
});
