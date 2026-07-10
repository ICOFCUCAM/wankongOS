import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { createApp } from "../src/app.js";
import { createAppContext } from "../src/context.js";

import type { AppContext } from "../src/context.js";
let ctx: AppContext;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  ctx = createAppContext({ store: createSeededStore(), registry: new ProviderRegistry(), organizationId: SEED_ORG_ID });
  app = createApp({ context: ctx, quiet: true });
  await ctx.ready;
});
const json = (body: unknown) => ({
  method: "POST" as const,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("platform billing (M6)", () => {
  it("reports plan, limits, and metered usage from records", async () => {
    const b = await (await app.request("/v1/billing")).json();
    expect(b.plan.id).toBe("growth"); // seeded demo plan
    expect(b.usage.employees).toBe(11);
    expect(b.usage.employeeLimit).toBe(50);
    expect(b.invoicePreview.note).toContain("not a charge");
  });

  it("enforces the employee limit at hire time with 402", async () => {
    // Force a small plan directly (downgrade API rightly refuses below headcount).
    await ctx.store.organizations.update(SEED_ORG_ID, { plan: "trial" });
    const res = await app.request("/v1/employees", json({
      departmentId: "dept_sales", name: "Overflow", title: "SDR", description: "d", systemPrompt: "p",
    }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toContain("Plan limit");

    await ctx.store.organizations.update(SEED_ORG_ID, { plan: "growth" });
    const ok = await app.request("/v1/employees", json({
      departmentId: "dept_sales", name: "Now Fits", title: "SDR", description: "d", systemPrompt: "p",
    }));
    expect(ok.status).toBe(201);
  });

  it("refuses downgrades below headcount and gates checkout on Stripe", async () => {
    const down = await app.request("/v1/billing/plan", json({ plan: "starter" }));
    expect(down.status).toBe(409);
    const checkout = await app.request("/v1/billing/checkout", json({}));
    expect(checkout.status).toBe(422);
    expect((await checkout.json()).error).toContain("Stripe");
  });
});

describe("role marketplace", () => {
  it("hires from a template with a working eval gate", async () => {
    const list = await (await app.request("/v1/marketplace/templates")).json();
    expect(list.data.length).toBeGreaterThanOrEqual(6);
    expect(list.data.every((t: { evalTasks: number }) => t.evalTasks >= 1)).toBe(true);

    const hired = await app.request("/v1/marketplace/hire", json({ templateId: "support-agent", name: "Sam" }));
    expect(hired.status).toBe(201);
    const { employee } = await hired.json();
    expect(employee.status).toBe("training");

    // The starter suite gates activation — and this one passes on the local provider.
    const activate = await app.request(`/v1/employees/${employee.id}/activate`, json({}));
    expect(activate.status).toBe(200);
    expect((await activate.json()).status).toBe("active");
  });

  it("404s unknown templates and respects plan limits", async () => {
    expect((await app.request("/v1/marketplace/hire", json({ templateId: "nope", name: "X" }))).status).toBe(404);
    await ctx.store.organizations.update(SEED_ORG_ID, { plan: "trial" });
    expect((await app.request("/v1/marketplace/hire", json({ templateId: "sdr", name: "Y" }))).status).toBe(402);
  });
});
