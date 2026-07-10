import { describe, expect, it } from "vitest";
import {
  detectAnomalies,
  engineFor,
  JournalEntry,
  JURISDICTION_ENGINES,
  trialBalance,
} from "@wankong/core";

const entry = (over: Partial<Record<string, unknown>> = {}) =>
  JournalEntry.parse({
    id: `jnl_${Math.abs(JSON.stringify(over).split("").reduce((n, c) => n * 31 + c.charCodeAt(0), 7))}`,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    organizationId: "org_1",
    date: "2026-07-01",
    source: "invoice",
    reference: "INV-1",
    lines: [
      { accountCode: "1200", debit: 125, credit: 0 },
      { accountCode: "4000", debit: 0, credit: 100 },
      { accountCode: "2200", debit: 0, credit: 25 },
    ],
    createdBy: { kind: "employee", id: "emp_1" },
    ...over,
  });

describe("jurisdiction engines", () => {
  it("loads distinct rule sets per country", () => {
    expect(JURISDICTION_ENGINES.length).toBeGreaterThanOrEqual(6);
    expect(engineFor("no")!.vatRate).toBe(0.25);
    expect(engineFor("UK")!.vatRate).toBe(0.2);
    expect(engineFor("US")!.vatRate).toBeNull(); // sales tax is sub-national
    expect(engineFor("NO")!.filings.some((f) => f.id === "saf-t")).toBe(true);
    expect(engineFor("DE")!.language).toBe("German");
  });
});

describe("double-entry ledger", () => {
  it("rejects unbalanced entries at the schema boundary", () => {
    expect(() =>
      entry({ lines: [{ accountCode: "1000", debit: 10, credit: 0 }, { accountCode: "4000", debit: 0, credit: 9 }] }),
    ).toThrow(/balance/);
  });

  it("derives a balanced trial balance with natural signs", () => {
    const tb = trialBalance(engineFor("NO")!, [entry()]);
    const ar = tb.find((a) => a.code === "1200")!;
    const rev = tb.find((a) => a.code === "4000")!;
    expect(ar.balance).toBe(125); // asset: debit-natural
    expect(rev.balance).toBe(100); // revenue: credit-natural
    expect(tb.reduce((n, a) => n + a.debit, 0)).toBe(tb.reduce((n, a) => n + a.credit, 0));
  });
});

describe("anomaly detection", () => {
  it("flags duplicate references and VAT mismatches", () => {
    const good = entry();
    const dup = entry({ id: "jnl_dup" });
    const badVat = entry({
      id: "jnl_vat",
      reference: "INV-2",
      lines: [
        { accountCode: "1200", debit: 110, credit: 0 },
        { accountCode: "4000", debit: 0, credit: 100 },
        { accountCode: "2200", debit: 0, credit: 10 }, // should be 25 in NO
      ],
    });
    const findings = detectAnomalies(engineFor("NO")!, [good, dup, badVat]);
    expect(findings.some((f) => f.code === "duplicate_reference")).toBe(true);
    expect(findings.some((f) => f.code === "vat_mismatch")).toBe(true);
    // The same books raise no VAT finding under a US engine (no federal VAT).
    const us = detectAnomalies(engineFor("US")!, [good, badVat]);
    expect(us.some((f) => f.code === "vat_mismatch")).toBe(false);
  });
});

describe("expanded jurisdiction registry", () => {
  it("ships 18 engines covering the initial checklist", () => {
    expect(JURISDICTION_ENGINES).toHaveLength(18);
    const codes = JURISDICTION_ENGINES.map((e) => e.code);
    for (const c of ["NO","SE","DK","FI","DE","FR","NL","BE","UK","IE","US","CA","AU","NZ","SG","JP","KR","ZA"]) {
      expect(codes).toContain(c);
    }
  });

  it("spot-checks rates, currencies, and disclosed payroll approximations", () => {
    expect(engineFor("FI")!.vatRate).toBe(0.255);
    expect(engineFor("SG")!.vatRate).toBe(0.09);
    expect(engineFor("AU")!.payroll.employerRate).toBe(0.12);
    expect(engineFor("JP")!.currency).toBe("JPY");
    expect(engineFor("ZA")!.filings.some((f) => f.id === "vat201")).toBe(true);
    // Every engine discloses payroll simplifications and carries a rules version.
    for (const e of JURISDICTION_ENGINES) {
      expect(e.rulesVersion).toBe("2026.07");
      expect(e.payroll.notes.length).toBeGreaterThan(0);
      expect(e.chartOfAccounts.length).toBeGreaterThan(0);
    }
  });
});
