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
const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("Company DNA", () => {
  it("seeds the demo org with a full operating context", async () => {
    const dna = await (await app.request("/v1/dna")).json();
    expect(dna.mission).toContain("robotics");
    expect(dna.style.register).toBe("formal");
    expect(dna.riskAppetite.level).toBe("low");
    expect(dna.policies.map((p: { id: string }) => p.id)).toEqual(["expense", "brand", "security"]);
  });

  it("updates DNA fields and audits the change", async () => {
    const res = await app.request("/v1/dna", json({ values: ["Speed", "Candour"] }, "PUT"));
    expect(res.status).toBe(200);
    expect((await res.json()).values).toEqual(["Speed", "Candour"]);
    const audit = await ctx.store.auditEvents.listByOrg(SEED_ORG_ID, (e) => e.action === "dna.update");
    expect(audit).toHaveLength(1);
  });

  it("policy engine: replace bumps the version; lookup matches rules text", async () => {
    const put = await app.request(
      "/v1/dna/policies/expense",
      json({ name: "Expense Policy", kind: "expense", rules: ["Expenses above $250 require pre-approval"] }, "PUT"),
    );
    const dna = await put.json();
    const expense = dna.policies.find((p: { id: string }) => p.id === "expense");
    expect(expense.version).toBe(2);

    const lookup = await (await app.request("/v1/dna/policies?q=pre-approval")).json();
    expect(lookup.data).toHaveLength(1);
    expect(lookup.data[0].id).toBe("expense");
  });

  it("every employee's grounded prompt carries the DNA section", async () => {
    const { buildEmployeePromptContext } = await import("../src/employee-context.js");
    const employee = (await ctx.store.employees.listByOrg(SEED_ORG_ID))[0]!;
    const context = await buildEmployeePromptContext(ctx.store, SEED_ORG_ID, employee);
    expect(context.companyDna).toContain("Mission:");
    expect(context.companyDna).toContain("Approval limits");
    expect(context.companyDna).toContain("Expense Policy v1");
  });

  it("policy.lookup tool answers from the DNA, not from prompt text", async () => {
    await ctx.ready;
    const tool = ctx.toolRegistry.get("policy.lookup");
    expect(tool).toBeTruthy();
    const out = await tool!.run({ query: "alcohol" }, { organizationId: SEED_ORG_ID, employee: (await ctx.store.employees.listByOrg(SEED_ORG_ID))[0]! } as never);
    expect(String(out)).toContain("Expense Policy v1");
    expect(String(out)).toContain("No alcohol");
  });
});
