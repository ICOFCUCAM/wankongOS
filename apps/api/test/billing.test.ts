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
    const checkout = await app.request("/v1/billing/checkout", json({ plan: "starter" }));
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

describe("eval drift detection", () => {
  it("flags a 15+ point decline against the best baseline and notifies", async () => {
    // Two synthetic reports: strong baseline, weak latest.
    await ctx.store.evalReports.create({
      organizationId: SEED_ORG_ID, employeeId: "emp_support_manager", suiteId: "evs_x",
      pass: true, passedTasks: 10, totalTasks: 10, results: [], trigger: "manual",
    } as never);
    await ctx.store.evalReports.create({
      organizationId: SEED_ORG_ID, employeeId: "emp_support_manager", suiteId: "evs_x",
      pass: false, passedTasks: 6, totalTasks: 10, results: [], trigger: "manual",
    } as never);
    const d = await (await app.request("/v1/employees/emp_support_manager/drift")).json();
    expect(d.drifting).toBe(true);
    expect(d.baseline).toBe(100);
    expect(d.recent).toBe(60);
    const inbox = await (await app.request("/v1/notifications")).json();
    expect(inbox.data.some((n: { kind: string }) => n.kind === "eval.drift")).toBe(true);
  });
});

describe("Stripe payment rails", () => {
  it("creates a checkout session and applies the plan only via the signed webhook", async () => {
    const { createHmac } = await import("node:crypto");
    await ctx.store.organizations.update(SEED_ORG_ID, { plan: "trial" });
    // Trial → checkout gated until Stripe is connected.
    expect((await app.request("/v1/billing/checkout", json({ plan: "growth" }))).status).toBe(422);

    await app.request("/v1/integrations", json({
      kind: "stripe", name: "Payments", config: { secretKey: "sk_test_x", webhookSecret: "whsec_y" },
    }));
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.stripe.com/v1/checkout/sessions");
      expect(String(init?.body)).toContain("unit_amount%5D=49900");
      return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" }), { status: 200 });
    }) as typeof fetch;
    try {
      const co = await (await app.request("/v1/billing/checkout", json({ plan: "growth" }))).json();
      expect(co.url).toContain("checkout.stripe.com");
    } finally {
      globalThis.fetch = realFetch;
    }
    // Redirect alone changed nothing.
    expect((await (await app.request("/v1/billing")).json()).plan.id).toBe("trial");

    const payload = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { metadata: { organizationId: SEED_ORG_ID, plan: "growth" } } },
    });
    const t = String(Math.floor(Date.now() / 1000));
    const v1 = createHmac("sha256", "whsec_y").update(`${t}.${payload}`).digest("hex");

    const forged = await app.request("/v1/billing/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": `t=${t},v1=${"0".repeat(64)}` }, body: payload,
    });
    expect(forged.status).toBe(401);

    const ok = await app.request("/v1/billing/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": `t=${t},v1=${v1}` }, body: payload,
    });
    expect(ok.status).toBe(200);
    expect((await (await app.request("/v1/billing")).json()).plan.id).toBe("growth");
  });
});
