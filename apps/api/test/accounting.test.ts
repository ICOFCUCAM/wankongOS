import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { createApp } from "../src/app.js";
import { createAppContext } from "../src/context.js";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp({
    context: createAppContext({ store: createSeededStore(), registry: new ProviderRegistry(), organizationId: SEED_ORG_ID }),
    quiet: true,
  });
});
const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const INVOICE = {
  date: "2026-07-01",
  source: "invoice",
  reference: "INV-100",
  lines: [
    { accountCode: "1200", debit: 125 },
    { accountCode: "4000", credit: 100 },
    { accountCode: "2200", credit: 25 },
  ],
};

describe("Global Accounting & Compliance", () => {
  it("loads the org's jurisdiction engine and can switch it", async () => {
    const before = await (await app.request("/v1/accounting/engine")).json();
    expect(before.engine.code).toBe("US");
    expect(before.safeguard).toContain("authorized accountant");

    const put = await app.request("/v1/accounting/jurisdiction", json({ code: "NO" }, "PUT"));
    expect((await put.json()).engine.vatName).toBe("MVA");
    const after = await (await app.request("/v1/accounting/engine")).json();
    expect(after.engine.currency).toBe("NOK");
  });

  it("posts balanced entries, rejects unbalanced ones, derives statements", async () => {
    await app.request("/v1/accounting/jurisdiction", json({ code: "NO" }, "PUT"));
    const ok = await app.request("/v1/accounting/entries", json(INVOICE));
    expect(ok.status).toBe(201);

    const bad = await app.request("/v1/accounting/entries", json({ ...INVOICE, reference: "INV-101", lines: [{ accountCode: "1200", debit: 10 }, { accountCode: "4000", credit: 9 }] }));
    expect(bad.status).toBe(400);

    const s = await (await app.request("/v1/accounting/statements")).json();
    expect(s.currency).toBe("NOK");
    expect(s.profitAndLoss.revenue).toBe(100);
    expect(s.balanceSheet.assets).toBe(125);
    // Accounting identity holds: assets = liabilities + equity(incl. net income)
    expect(s.balanceSheet.assets).toBeCloseTo(s.balanceSheet.liabilities + s.balanceSheet.equity, 2);
  });

  it("detects duplicates and VAT mismatches under the active engine", async () => {
    await app.request("/v1/accounting/jurisdiction", json({ code: "NO" }, "PUT"));
    await app.request("/v1/accounting/entries", json(INVOICE));
    await app.request("/v1/accounting/entries", json(INVOICE)); // duplicate INV-100
    await app.request("/v1/accounting/entries", json({ ...INVOICE, reference: "INV-102", lines: [{ accountCode: "1200", debit: 110 }, { accountCode: "4000", credit: 100 }, { accountCode: "2200", credit: 10 }] }));
    const { data } = await (await app.request("/v1/accounting/anomalies")).json();
    const codes = data.map((f: { code: string }) => f.code);
    expect(codes).toContain("duplicate_reference");
    expect(codes).toContain("vat_mismatch");
  });

  it("hires the 13-role department idempotently", async () => {
    const first = await app.request("/v1/accounting/hire-department", json({}));
    expect(first.status).toBe(201);
    const body = await first.json();
    expect(body.hired).toBe(13);
    expect(body.department.name).toBe("Global Accounting & Compliance");

    const second = await (await app.request("/v1/accounting/hire-department", json({}))).json();
    expect(second.hired).toBe(0); // idempotent

    const employees = await (await app.request("/v1/employees")).json();
    const titles = employees.data.map((e: { title: string }) => e.title);
    expect(titles).toContain("Chief Accountant");
    expect(titles).toContain("VAT/GST Specialist");
    expect(titles).toContain("Compliance Officer");
  });
});

describe("filing documents from the ledger", () => {
  it("generates a jurisdiction-aware VAT return with the safeguard", async () => {
    await app.request("/v1/accounting/jurisdiction", json({ code: "NO" }, "PUT"));
    await app.request("/v1/accounting/entries", json(INVOICE));
    const res = await app.request("/v1/studios/financial/generate", json({ kind: "vat_return" }));
    expect(res.status).toBe(201);
    const asset = await res.json();
    expect(asset.content).toContain("MVA");
    expect(asset.content).toContain("Norwegian");
    expect(asset.content).toContain("authorized accountant");
    expect(asset.content).toContain("25.00"); // 25% of 100 recorded revenue
  });

  it("explains sub-national sales tax honestly for the US engine", async () => {
    const res = await app.request("/v1/studios/financial/generate", json({ kind: "vat_return" }));
    const asset = await res.json();
    expect(asset.content).toContain("no national VAT");
  });
});
