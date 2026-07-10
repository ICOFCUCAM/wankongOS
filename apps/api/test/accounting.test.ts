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

describe("accounting periods preserve integrity", () => {
  it("blocks postings into a closed period; reopening needs a reason and is audited", async () => {
    const close = await app.request("/v1/accounting/periods/2026-07/close", json({}));
    expect(close.status).toBe(200);

    const blocked = await app.request("/v1/accounting/entries", json(INVOICE));
    expect(blocked.status).toBe(409);

    const noReason = await app.request("/v1/accounting/periods/2026-07/reopen", json({}));
    expect(noReason.status).toBe(400);

    const reopened = await app.request(
      "/v1/accounting/periods/2026-07/reopen",
      json({ reason: "Late supplier invoice for July." }),
    );
    expect(reopened.status).toBe(200);
    expect((await app.request("/v1/accounting/entries", json(INVOICE))).status).toBe(201);

    const trail = await (await app.request("/v1/accounting/audit-trail")).json();
    const actions = trail.data.map((e: { action: string }) => e.action);
    expect(actions).toContain("accounting.period.close");
    expect(actions).toContain("accounting.period.reopen");
    expect(actions).toContain("accounting.entry.post");
  });

  it("statements include derived cash flow", async () => {
    await app.request("/v1/accounting/entries", json({ ...INVOICE, reference: "INV-CF", lines: [{ accountCode: "1000", debit: 50 }, { accountCode: "4000", credit: 50 }] }));
    const s = await (await app.request("/v1/accounting/statements")).json();
    expect(s.cashFlow.net).toBe(50);
  });
});

describe("one-click audit package", () => {
  it("bundles GL, trial balance, adjustments, and period status", async () => {
    await app.request("/v1/accounting/entries", json(INVOICE));
    await app.request("/v1/accounting/periods/2026-06/close", json({}));
    const res = await app.request("/v1/studios/financial/generate", json({ kind: "audit_package" }));
    expect(res.status).toBe(201);
    const asset = await res.json();
    expect(asset.content).toContain("General ledger (1 entries)");
    expect(asset.content).toContain("INV-100");
    expect(asset.content).toContain("Closed periods: 2026-06");
    expect(asset.content).toContain("authorized accountant");
  });
});

describe("multi-company consolidation", () => {
  it("keeps separate books per entity, each under its own engine", async () => {
    const no = await (await app.request("/v1/accounting/companies", json({ name: "Acme Norway AS", jurisdiction: "NO" }))).json();
    const uk = await (await app.request("/v1/accounting/companies", json({ name: "Acme UK Ltd", jurisdiction: "UK" }))).json();

    await app.request("/v1/accounting/entries", json({ ...INVOICE, companyId: no.id, reference: "NO-1" }));
    await app.request("/v1/accounting/entries", json({
      date: "2026-07-02", source: "invoice", reference: "UK-1", companyId: uk.id,
      lines: [{ accountCode: "1200", debit: 240 }, { accountCode: "4000", credit: 200 }, { accountCode: "2200", credit: 40 }],
    }));

    const noStmt = await (await app.request(`/v1/accounting/statements?companyId=${no.id}`)).json();
    expect(noStmt.currency).toBe("NOK");
    expect(noStmt.profitAndLoss.revenue).toBe(100);
    const ukStmt = await (await app.request(`/v1/accounting/statements?companyId=${uk.id}`)).json();
    expect(ukStmt.currency).toBe("GBP");
    expect(ukStmt.profitAndLoss.revenue).toBe(200);
  });

  it("consolidates per currency and refuses to fake FX translation", async () => {
    const no = await (await app.request("/v1/accounting/companies", json({ name: "Acme Norway AS", jurisdiction: "NO" }))).json();
    await app.request("/v1/accounting/entries", json({ ...INVOICE, companyId: no.id, reference: "NO-2" }));
    await app.request("/v1/accounting/entries", json(INVOICE)); // primary (US)

    const cons = await (await app.request("/v1/accounting/consolidated")).json();
    expect(cons.byCurrency.NOK.revenue).toBe(100);
    expect(cons.byCurrency.USD.revenue).toBe(100);
    expect(cons.note).toContain("NOT applied");
    expect(cons.safeguard).toContain("authorized accountant");
  });

  it("rejects entities in jurisdictions without an engine", async () => {
    const res = await app.request("/v1/accounting/companies", json({ name: "Acme Mars", jurisdiction: "MR" }));
    expect(res.status).toBe(422);
  });
});

describe("bank feed import and auto-reconciliation", () => {
  it("imports CSV, matches by reference and by amount+date, drafts the rest", async () => {
    await app.request("/v1/accounting/entries", json(INVOICE)); // ref INV-100, no cash line
    await app.request("/v1/accounting/entries", json({
      date: "2026-07-03", source: "bank", reference: "PAY-7",
      lines: [{ accountCode: "1000", debit: 500 }, { accountCode: "4000", credit: 500 }],
    }));

    const imp = await app.request("/v1/accounting/bank/import", json({
      csv: "date,description,amount,reference\n2026-07-01,Customer payment,125,INV-100\n2026-07-04,Card settlement,500,\n2026-07-05,Office rent,-900,",
    }));
    expect(imp.status).toBe(201);
    expect((await imp.json()).imported).toBe(3);

    const rec = await (await app.request("/v1/accounting/bank/reconcile", json({}))).json();
    expect(rec.matched).toHaveLength(2);
    expect(rec.matched.map((m: { rule: string }) => m.rule).sort()).toEqual(["amount_date", "reference"]);
    expect(rec.unmatched).toBe(1);
    // The rent line is drafted as an expense entry — for review, not posted.
    expect(rec.suggestions).toHaveLength(1);
    expect(rec.suggestions[0].draft.lines[0]).toEqual({ accountCode: "6000", debit: 900 });
    expect(rec.note).toContain("review");

    const entriesBefore = (await (await app.request("/v1/accounting/entries")).json()).data.length;
    expect(entriesBefore).toBe(2); // nothing auto-posted

    const status = await (await app.request("/v1/accounting/bank")).json();
    expect(status.matched).toBe(2);
    expect(status.unmatched).toBe(1);
  });
});

describe("FX translation with recorded rates only", () => {
  it("translates consolidated totals when rates exist, refuses when missing", async () => {
    const no = await (await app.request("/v1/accounting/companies", json({ name: "Acme Norway AS", jurisdiction: "NO" }))).json();
    await app.request("/v1/accounting/entries", json({ ...INVOICE, companyId: no.id, reference: "NO-FX" }));
    await app.request("/v1/accounting/entries", json(INVOICE)); // primary in USD

    // No NOK->USD rate yet: NOK entity excluded and reported missing.
    const before = await (await app.request("/v1/accounting/consolidated?presentation=USD")).json();
    expect(before.presentation.missingRates).toContain("NOK->USD");
    expect(before.presentation.revenue).toBe(100); // USD entity only

    await app.request("/v1/accounting/fx-rates", json({ base: "NOK", quote: "USD", rate: 0.095, asOf: "2026-07-01" }));
    const after = await (await app.request("/v1/accounting/consolidated?presentation=USD")).json();
    expect(after.presentation.missingRates).toHaveLength(0);
    expect(after.presentation.revenue).toBeCloseTo(100 + 100 * 0.095, 2);
    expect(after.presentation.method).toContain("Not a full IAS 21");
  });

  it("uses inverse rates when only the opposite pair is recorded", async () => {
    await app.request("/v1/accounting/fx-rates", json({ base: "USD", quote: "NOK", rate: 10.5 }));
    const no = await (await app.request("/v1/accounting/companies", json({ name: "Acme Norway AS", jurisdiction: "NO" }))).json();
    await app.request("/v1/accounting/entries", json({ ...INVOICE, companyId: no.id, reference: "NO-INV2" }));
    const cons = await (await app.request("/v1/accounting/consolidated?presentation=USD")).json();
    expect(cons.presentation.missingRates).toHaveLength(0);
    expect(cons.presentation.revenue).toBeCloseTo(100 / 10.5, 2);
  });
});
