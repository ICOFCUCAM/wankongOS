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
const json = (body: unknown) => ({
  method: "POST" as const,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Install a pack and activate its hires (installs land in training). */
async function staffPack(packId: string) {
  const res = await app.request("/v1/marketplace/install-pack", json({ packId }));
  expect(res.status).toBeLessThan(300);
  const dept = (await ctx.store.departments.listByOrg(SEED_ORG_ID, (d) => d.slug === `${packId}-pack`))[0]!;
  const hires = await ctx.store.employees.listByOrg(SEED_ORG_ID, (e) => e.departmentId === dept.id);
  for (const h of hires) await ctx.store.employees.update(h.id, { status: "active" });
  return hires;
}

describe("intelligence evidence pack", () => {
  it("derives cross-department metrics with disclosed formulas and limits", async () => {
    const m = await (await app.request("/v1/intelligence/metrics")).json();
    expect(m.revenueByMonth).toHaveLength(3);
    expect(m.expensesByMonth).toHaveLength(3);
    expect(m.departments.length).toBeGreaterThan(0);
    expect(m.departments[0]).toHaveProperty("completedLast14d");
    expect(m.formulas.join("\n")).toContain("4xxx ledger accounts");
    expect(m.formulas.join("\n")).toContain("deltaPct");
    expect(m.limits).toContain("no CRM");
  });
});

describe("BI department (ask)", () => {
  it("is honestly gated until the BI department is staffed", async () => {
    const res = await app.request("/v1/intelligence/ask", json({ question: "Why are sales down?" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("marketplace");
  });

  it("answers from the evidence pack and files a searchable brief", async () => {
    await staffPack("business-intelligence");
    const res = await app.request("/v1/intelligence/ask", json({ question: "Why are sales down?" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.analyst.name).toBeTruthy();
    expect(body.evidence.formulas.length).toBeGreaterThan(0);

    const brief = await ctx.store.assets.get(body.briefAssetId);
    expect(brief?.kind).toBe("bi_brief");
    expect(brief?.content).toContain("Evidence pack");

    const audit = await ctx.store.auditEvents.listByOrg(SEED_ORG_ID, (e) => e.action === "intelligence.ask");
    expect(audit).toHaveLength(1);
  });
});

describe("Strategy Office (plan)", () => {
  it("is honestly gated until the Strategy Office is staffed", async () => {
    const res = await app.request("/v1/intelligence/plan", json({ goal: "Reach $10M ARR" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Strategy Office");
  });

  it("plans as disclosed scenario math over recorded numbers", async () => {
    await staffPack("strategy");
    const res = await app.request("/v1/intelligence/plan", json({ goal: "Reach $10M ARR" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.plan.length).toBeGreaterThan(0);
    expect(body.scenario.runRateFormula).toContain("not a forecast");
    expect(body.scenario).toHaveProperty("annualRunRateUsd");

    const plan = await ctx.store.assets.get(body.planAssetId);
    expect(plan?.kind).toBe("strategy_plan");
    expect(plan?.content).toContain("illustrative scenarios");
  });
});
