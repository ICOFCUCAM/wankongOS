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

const YEAR = new Date().toISOString().slice(0, 4);

async function postEntry() {
  const res = await app.request(
    "/v1/accounting/entries",
    json({
      date: `${YEAR}-03-15`,
      memo: "Consulting revenue",
      source: "manual",
      reference: "INV-100",
      lines: [
        { accountCode: "1200", description: "Receivable", debit: 1000, credit: 0 },
        { accountCode: "4000", description: "Revenue", debit: 0, credit: 1000 },
      ],
    }),
  );
  expect(res.status).toBeLessThan(300);
}

describe("SAF-T export", () => {
  it("is gated to jurisdictions whose rules package files SAF-T", async () => {
    // Seeded org is US — SAF-T is not a US filing.
    const res = await app.request(`/v1/accounting/exports/saf-t?year=${YEAR}`);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("United States");
  });

  it("produces a well-formed simplified SAF-T file from recorded entries", async () => {
    await app.request("/v1/accounting/jurisdiction", json({ code: "NO" }, "PUT"));
    await postEntry();
    const res = await app.request(`/v1/accounting/exports/saf-t?year=${YEAR}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain("<?xml version=");
    expect(xml).toContain("urn:StandardAuditFile-Taxation-Financial:NO");
    expect(xml).toContain("simplified subset"); // honest about scope
    expect(xml).toContain("Validate with the tax authority");
    expect(xml).toContain("<AccountID>4000</AccountID>");
    expect(xml).toContain("<CreditAmount><Amount>1000.00</Amount></CreditAmount>");
    expect(xml).toContain("<DefaultCurrencyCode>NOK</DefaultCurrencyCode>");
    // Balanced control totals.
    expect(xml).toMatch(/<TotalDebit>(\d+\.\d\d)<\/TotalDebit>/);
    const debit = /<TotalDebit>([\d.]+)<\/TotalDebit>/.exec(xml)![1];
    const credit = /<TotalCredit>([\d.]+)<\/TotalCredit>/.exec(xml)![1];
    expect(debit).toBe(credit);
  });
});

describe("FEC export", () => {
  it("is gated to the French rules package", async () => {
    const res = await app.request(`/v1/accounting/exports/fec?year=${YEAR}`);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("FEC");
  });

  it("emits the 18 mandatory pipe-separated columns, one row per journal line", async () => {
    await app.request("/v1/accounting/jurisdiction", json({ code: "FR" }, "PUT"));
    await postEntry();
    const res = await app.request(`/v1/accounting/exports/fec?year=${YEAR}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const [header, ...rows] = text.trim().split("\n");
    expect(header!.split("|")).toHaveLength(18);
    expect(header).toBe(
      "JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLet|DateLet|ValidDate|Montantdevise|Idevise",
    );
    expect(rows.length).toBeGreaterThanOrEqual(2); // two lines of the balanced entry
    for (const row of rows) expect(row.split("|")).toHaveLength(18);
    const revenueRow = rows.find((r) => r.includes("|4000|"))!;
    const cols = revenueRow.split("|");
    expect(cols[3]).toBe(`${YEAR}0315`); // EcritureDate as YYYYMMDD
    expect(cols[8]).toBe("INV-100"); // PieceRef from the entry reference
    expect(cols[12]).toBe("1000,00"); // French decimal comma
    expect(res.headers.get("x-safeguard")).toContain("Validate with the DGFiP");
  });
});

describe("jurisdiction packages (two-layer accounting)", () => {
  it("lists every jurisdiction as a versioned package with exports and gated portals", async () => {
    const res = await app.request("/v1/accounting/packages");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.layers.universalLedger).toContain("never changes");
    expect(body.data.length).toBeGreaterThanOrEqual(18);
    const no = body.data.find((p: { code: string }) => p.code === "NO");
    expect(no.rulesVersion).toBe("2026.07");
    expect(no.structuredExports).toContain("saf-t");
    expect(no.eFilingPortal.name).toBe("Altinn");
    expect(no.eFilingPortal.status).toContain("never submits");
    const fr = body.data.find((p: { code: string }) => p.code === "FR");
    expect(fr.structuredExports).toContain("fec");
    const us = body.data.find((p: { code: string }) => p.code === "US");
    expect(us.structuredExports).toEqual([]);
  });
});
