import { z } from "zod";

const Id = z.string().min(1).max(80);
const Timestamp = z.string().datetime();

/**
 * Global Accounting & Compliance (ADR-0022).
 *
 * Finance advises; Accounting maintains the official books. The department
 * loads a JURISDICTION ENGINE — rules data, not hardcoded logic — and every
 * produced document carries the review safeguard below.
 */
export const ACCOUNTING_SAFEGUARD =
  "Prepared by the Global Accounting & Compliance Department from recorded transactions under the jurisdiction rules stated above. Items may require review, approval, or certification by an authorized accountant or company officer where local law requires it. Rule engines are updated continuously; verify rates and filing requirements before submission.";

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface AccountDef {
  code: string;
  name: string;
  type: AccountType;
}

export interface FilingDef {
  id: string;
  name: string;
  period: "monthly" | "quarterly" | "yearly" | "bimonthly";
}

export interface JurisdictionEngine {
  code: string;
  /** Rules-package version — engines are versioned data, updated over time. */
  rulesVersion: string;
  country: string;
  currency: string;
  /** Official filing language; internal copies may be translated. */
  language: string;
  standard: string;
  /** Standard VAT/GST rate as a fraction, or null where sales tax is sub-national (e.g. US). */
  vatRate: number | null;
  vatName: string;
  filings: FilingDef[];
  /** Minimal standard chart of accounts for the jurisdiction. */
  chartOfAccounts: AccountDef[];
  /** Employer payroll contribution — the STANDARD rate, simplified. */
  payroll: { name: string; employerRate: number; notes: string[] };
  notes: string[];
}

const BASE_COA: AccountDef[] = [
  { code: "1000", name: "Cash & bank", type: "asset" },
  { code: "1200", name: "Accounts receivable", type: "asset" },
  { code: "1500", name: "Fixed assets", type: "asset" },
  { code: "2000", name: "Accounts payable", type: "liability" },
  { code: "2200", name: "VAT payable", type: "liability" },
  { code: "2400", name: "Payroll liabilities", type: "liability" },
  { code: "3000", name: "Share capital", type: "equity" },
  { code: "3900", name: "Retained earnings", type: "equity" },
  { code: "4000", name: "Revenue", type: "revenue" },
  { code: "5000", name: "Cost of goods sold", type: "expense" },
  { code: "6000", name: "Operating expenses", type: "expense" },
  { code: "6500", name: "Payroll expenses", type: "expense" },
];

export const JURISDICTION_ENGINES: JurisdictionEngine[] = [
  { code: "NO", rulesVersion: "2026.07", payroll: { name: "Arbeidsgiveravgift", employerRate: 0.141, notes: ["Standard zone rate; regional zones (0–14.1%) not modeled."] }, country: "Norway", currency: "NOK", language: "Norwegian", standard: "Norwegian Accounting Act (regnskapsloven) + Bookkeeping Act", vatRate: 0.25, vatName: "MVA", filings: [ { id: "saf-t", name: "SAF-T Financial export", period: "yearly" }, { id: "mva-melding", name: "MVA-melding (VAT return)", period: "bimonthly" }, { id: "arsregnskap", name: "Årsregnskap (annual accounts)", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: ["Employer contributions (arbeidsgiveravgift) vary by region.", "Altinn is the filing portal."] },
  { code: "SE", rulesVersion: "2026.07", payroll: { name: "Arbetsgivaravgifter", employerRate: 0.3142, notes: ["Full statutory rate; reduced age brackets not modeled."] }, country: "Sweden", currency: "SEK", language: "Swedish", standard: "Bokföringslagen + K2/K3", vatRate: 0.25, vatName: "Moms", filings: [ { id: "momsdeklaration", name: "Momsdeklaration", period: "quarterly" }, { id: "arsredovisning", name: "Årsredovisning", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: ["BAS chart of accounts is the national convention."] },
  { code: "UK", rulesVersion: "2026.07", payroll: { name: "Employer NI", employerRate: 0.138, notes: ["Flat above-threshold approximation; secondary threshold not modeled."] }, country: "United Kingdom", currency: "GBP", language: "English", standard: "UK GAAP (FRS 102) / IFRS", vatRate: 0.20, vatName: "VAT", filings: [ { id: "vat-return", name: "VAT Return (Making Tax Digital)", period: "quarterly" }, { id: "ct600", name: "Corporation Tax (CT600)", period: "yearly" }, { id: "annual-accounts", name: "Companies House annual accounts", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: ["PAYE for payroll; MTD requires digital VAT records."] },
  { code: "US", rulesVersion: "2026.07", payroll: { name: "Employer FICA", employerRate: 0.0765, notes: ["Social Security + Medicare employer share; FUTA/SUTA and wage caps not modeled."] }, country: "United States", currency: "USD", language: "English", standard: "US GAAP", vatRate: null, vatName: "Sales tax (state/local)", filings: [ { id: "form-1120", name: "Federal corporate return (1120)", period: "yearly" }, { id: "941", name: "Payroll tax (Form 941)", period: "quarterly" }, { id: "1099-w2", name: "1099 / W-2 information returns", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: ["Sales tax is state/local — no federal VAT.", "Multi-state payroll requires per-state registration."] },
  { code: "DE", rulesVersion: "2026.07", payroll: { name: "SV-Arbeitgeberanteil", employerRate: 0.20, notes: ["Approximate employer share of social insurance; caps and Umlagen not modeled."] }, country: "Germany", currency: "EUR", language: "German", standard: "HGB", vatRate: 0.19, vatName: "USt", filings: [ { id: "ust-va", name: "Umsatzsteuervoranmeldung", period: "monthly" }, { id: "jahresabschluss", name: "Jahresabschluss", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: ["SKR03/SKR04 charts are the national convention; ELSTER is the portal."] },
  { code: "CA", rulesVersion: "2026.07", payroll: { name: "CPP + EI (employer)", employerRate: 0.0766, notes: ["Approximate combined employer share; YMPE caps not modeled."] }, country: "Canada", currency: "CAD", language: "English/French", standard: "ASPE / IFRS", vatRate: 0.05, vatName: "GST/HST", filings: [ { id: "gst-return", name: "GST/HST return", period: "quarterly" }, { id: "t2", name: "T2 corporate return", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: ["HST rates vary by province on top of federal GST."] },

  { code: "DK", country: "Denmark", currency: "DKK", language: "Danish", standard: "Årsregnskabsloven + Bogføringsloven", rulesVersion: "2026.07", vatRate: 0.25, vatName: "Moms", payroll: { name: "ATP/AUB m.fl.", employerRate: 0.012, notes: ["Danish employer contributions are largely fixed-amount (ATP, AUB); approximated as ~1.2% of gross."] }, filings: [ { id: "momsangivelse", name: "Momsangivelse", period: "quarterly" }, { id: "arsrapport", name: "Årsrapport (Erhvervsstyrelsen)", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: ["Digital bookkeeping requirements apply under the Bookkeeping Act."] },
  { code: "FI", country: "Finland", currency: "EUR", language: "Finnish", standard: "Kirjanpitolaki (Accounting Act)", rulesVersion: "2026.07", vatRate: 0.255, vatName: "ALV", payroll: { name: "TyEL + sotu", employerRate: 0.19, notes: ["Average TyEL + health insurance employer share; age/size variation not modeled."] }, filings: [ { id: "alv-ilmoitus", name: "ALV return (OmaVero)", period: "monthly" }, { id: "tilinpaatos", name: "Tilinpäätös", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: ["Standard ALV rate rose to 25.5% in 2024."] },
  { code: "FR", country: "France", currency: "EUR", language: "French", standard: "Plan Comptable Général (PCG)", rulesVersion: "2026.07", vatRate: 0.20, vatName: "TVA", payroll: { name: "Charges patronales", employerRate: 0.42, notes: ["Employer charges vary roughly 25–45% with salary level and reliefs; 42% used as a plain approximation."] }, filings: [ { id: "ca3", name: "Déclaration TVA (CA3)", period: "monthly" }, { id: "liasse", name: "Liasse fiscale", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: ["FEC export is required on tax audit."] },
  { code: "NL", country: "Netherlands", currency: "EUR", language: "Dutch", standard: "Dutch GAAP (Titel 9 Boek 2 BW)", rulesVersion: "2026.07", vatRate: 0.21, vatName: "BTW", payroll: { name: "Werkgeverslasten", employerRate: 0.18, notes: ["Approximate employer premiums; sector funds and caps not modeled."] }, filings: [ { id: "btw-aangifte", name: "BTW-aangifte", period: "quarterly" }, { id: "jaarrekening", name: "Jaarrekening (KvK)", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: [] },
  { code: "BE", country: "Belgium", currency: "EUR", language: "Dutch/French", standard: "BE GAAP (CBN/CNC)", rulesVersion: "2026.07", vatRate: 0.21, vatName: "BTW/TVA", payroll: { name: "ONSS/RSZ", employerRate: 0.25, notes: ["Basic employer rate; reductions and sector schemes not modeled."] }, filings: [ { id: "btw", name: "BTW/TVA return", period: "quarterly" }, { id: "jaarrekening-nbb", name: "Jaarrekening (NBB)", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: [] },
  { code: "IE", country: "Ireland", currency: "EUR", language: "English", standard: "FRS 102 / IFRS", rulesVersion: "2026.07", vatRate: 0.23, vatName: "VAT", payroll: { name: "Employer PRSI", employerRate: 0.1105, notes: ["Class A higher rate; lower band not modeled."] }, filings: [ { id: "vat3", name: "VAT3 return", period: "bimonthly" }, { id: "ct1", name: "Corporation Tax (CT1)", period: "yearly" }, { id: "cro-b1", name: "CRO annual return (B1)", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: [] },
  { code: "AU", country: "Australia", currency: "AUD", language: "English", standard: "AASB (IFRS-based)", rulesVersion: "2026.07", vatRate: 0.10, vatName: "GST", payroll: { name: "Superannuation guarantee", employerRate: 0.12, notes: ["Super guarantee only; state payroll tax not modeled."] }, filings: [ { id: "bas", name: "Business Activity Statement", period: "quarterly" }, { id: "ctr", name: "Company tax return", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: [] },
  { code: "NZ", country: "New Zealand", currency: "NZD", language: "English", standard: "NZ IFRS (XRB)", rulesVersion: "2026.07", vatRate: 0.15, vatName: "GST", payroll: { name: "KiwiSaver (employer)", employerRate: 0.03, notes: ["Minimum employer KiwiSaver; ESCT not modeled."] }, filings: [ { id: "gst101", name: "GST return", period: "bimonthly" }, { id: "ir4", name: "IR4 company return", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: [] },
  { code: "SG", country: "Singapore", currency: "SGD", language: "English", standard: "SFRS(I)", rulesVersion: "2026.07", vatRate: 0.09, vatName: "GST", payroll: { name: "CPF (employer)", employerRate: 0.17, notes: ["Rate for residents under 55; age bands and wage ceilings not modeled."] }, filings: [ { id: "gst-f5", name: "GST F5", period: "quarterly" }, { id: "form-cs", name: "Form C-S (IRAS)", period: "yearly" }, { id: "acra-ar", name: "ACRA annual return", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: [] },
  { code: "JP", country: "Japan", currency: "JPY", language: "Japanese", standard: "J-GAAP", rulesVersion: "2026.07", vatRate: 0.10, vatName: "消費税 (Consumption tax)", payroll: { name: "社会保険 employer share", employerRate: 0.155, notes: ["Approximate employer share of social insurance; prefecture variation not modeled."] }, filings: [ { id: "shouhizei", name: "Consumption tax return", period: "yearly" }, { id: "houjinzei", name: "Corporate tax return", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: ["Qualified invoice system (インボイス制度) applies."] },
  { code: "KR", country: "South Korea", currency: "KRW", language: "Korean", standard: "K-IFRS", rulesVersion: "2026.07", vatRate: 0.10, vatName: "부가가치세 (VAT)", payroll: { name: "4대보험 employer share", employerRate: 0.11, notes: ["Approximate combined employer share of the four major insurances."] }, filings: [ { id: "vat-return", name: "VAT return", period: "quarterly" }, { id: "cit", name: "Corporate income tax", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: [] },
  { code: "ZA", country: "South Africa", currency: "ZAR", language: "English", standard: "IFRS / IFRS for SMEs", rulesVersion: "2026.07", vatRate: 0.15, vatName: "VAT", payroll: { name: "UIF + SDL", employerRate: 0.02, notes: ["UIF 1% (capped) + SDL 1%; caps not modeled."] }, filings: [ { id: "vat201", name: "VAT201", period: "bimonthly" }, { id: "itr14", name: "ITR14 company return", period: "yearly" } ], chartOfAccounts: BASE_COA, notes: [] },
];

export function engineFor(code: string): JurisdictionEngine | undefined {
  return JURISDICTION_ENGINES.find((e) => e.code === code.toUpperCase());
}

export const JournalLine = z.object({
  accountCode: z.string().min(1).max(20),
  description: z.string().max(500).default(""),
  debit: z.number().min(0).default(0),
  credit: z.number().min(0).default(0),
});

export const JournalEntry = z
  .object({
    id: Id,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    organizationId: Id,
    date: z.string().min(8).max(30),
    memo: z.string().max(500).default(""),
    source: z.enum(["manual", "invoice", "bank", "payroll", "inventory", "adjustment"]).default("manual"),
    /** Entity whose books this entry belongs to; absent = the primary company. */
    companyId: Id.optional(),
    /** External reference (invoice #, bank tx id) — duplicate detection key. */
    reference: z.string().max(120).optional(),
    lines: z.array(JournalLine).min(2),
    createdBy: z.object({ kind: z.enum(["user", "employee"]), id: Id }),
  })
  .refine(
    (e) => {
      const d = e.lines.reduce((n, l) => n + l.debit, 0);
      const c = e.lines.reduce((n, l) => n + l.credit, 0);
      return Math.abs(d - c) < 0.005;
    },
    { message: "Journal entry must balance: total debits must equal total credits" },
  );
export type JournalEntry = z.infer<typeof JournalEntry>;

export interface AccountBalance extends AccountDef {
  debit: number;
  credit: number;
  balance: number;
}

/** Trial balance over posted entries against the engine's chart. */
export function trialBalance(engine: JurisdictionEngine, entries: JournalEntry[]): AccountBalance[] {
  const byCode = new Map(engine.chartOfAccounts.map((a) => [a.code, { ...a, debit: 0, credit: 0, balance: 0 }]));
  for (const e of entries) {
    for (const l of e.lines) {
      const acc =
        byCode.get(l.accountCode) ??
        byCode
          .set(l.accountCode, { code: l.accountCode, name: `Account ${l.accountCode}`, type: "expense", debit: 0, credit: 0, balance: 0 })
          .get(l.accountCode)!;
      acc.debit += l.debit;
      acc.credit += l.credit;
    }
  }
  for (const acc of byCode.values()) {
    const natural = acc.type === "asset" || acc.type === "expense" ? 1 : -1;
    acc.balance = Math.round((acc.debit - acc.credit) * natural * 100) / 100;
    acc.debit = Math.round(acc.debit * 100) / 100;
    acc.credit = Math.round(acc.credit * 100) / 100;
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** A legal entity holding its own ledger — subsidiaries under one org. */
export const Company = z.object({
  id: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  organizationId: Id,
  name: z.string().min(1).max(160),
  /** Jurisdiction engine code for THIS entity's books. */
  jurisdiction: z.string().max(4),
  parentCompanyId: Id.optional(),
});
export type Company = z.infer<typeof Company>;

export const AccountingPeriod = z.object({
  id: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  organizationId: Id,
  /** Month key, e.g. "2026-07". */
  period: z.string().regex(/^\d{4}-\d{2}$/),
  status: z.enum(["open", "closed"]).default("open"),
  closedBy: Id.optional(),
  closedAt: Timestamp.optional(),
  /** Controlled procedure: reopening requires a recorded reason. */
  reopenedReason: z.string().max(500).optional(),
});
export type AccountingPeriod = z.infer<typeof AccountingPeriod>;

/** Net cash movement derived from the cash account (1000) — never stored. */
export function cashFlow(entries: JournalEntry[]): { inflow: number; outflow: number; net: number } {
  let inflow = 0, outflow = 0;
  for (const e of entries) for (const l of e.lines) {
    if (!l.accountCode.startsWith("10")) continue;
    inflow += l.debit; outflow += l.credit;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { inflow: r(inflow), outflow: r(outflow), net: r(inflow - outflow) };
}

/** An imported bank-statement line. Reconciliation links it to a journal entry. */
export const BankTransaction = z.object({
  id: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  organizationId: Id,
  companyId: Id.optional(),
  date: z.string().min(8).max(30),
  description: z.string().max(300).default(""),
  /** Signed amount: positive = money in, negative = money out. */
  amount: z.number(),
  reference: z.string().max(120).optional(),
  status: z.enum(["unmatched", "matched"]).default("unmatched"),
  matchedEntryId: Id.optional(),
});
export type BankTransaction = z.infer<typeof BankTransaction>;

/** Net cash movement of one journal entry (its 10xx lines). */
export function entryCashMovement(e: JournalEntry): number {
  return Math.round(e.lines.filter((l) => l.accountCode.startsWith("10")).reduce((n, l) => n + l.debit - l.credit, 0) * 100) / 100;
}

/**
 * Deterministic reconciliation: a bank line matches a journal entry when the
 * reference matches exactly, or when the cash movement equals the amount and
 * the dates are within 5 days. One entry matches at most one line.
 */
export function reconcile(
  transactions: BankTransaction[],
  entries: JournalEntry[],
): { matches: { transactionId: string; entryId: string; rule: "reference" | "amount_date" }[]; unmatched: BankTransaction[] } {
  const used = new Set<string>();
  const matches: { transactionId: string; entryId: string; rule: "reference" | "amount_date" }[] = [];
  const unmatched: BankTransaction[] = [];
  for (const tx of transactions) {
    if (tx.status === "matched") continue;
    let hit = tx.reference
      ? entries.find((e) => !used.has(e.id) && e.reference && e.reference === tx.reference)
      : undefined;
    let rule: "reference" | "amount_date" = "reference";
    if (!hit) {
      hit = entries.find(
        (e) =>
          !used.has(e.id) &&
          entryCashMovement(e) === tx.amount &&
          Math.abs(Date.parse(e.date) - Date.parse(tx.date)) <= 5 * 86400_000,
      );
      rule = "amount_date";
    }
    if (hit) {
      used.add(hit.id);
      matches.push({ transactionId: tx.id, entryId: hit.id, rule });
    } else {
      unmatched.push(tx);
    }
  }
  return { matches, unmatched };
}

/** A recorded exchange rate: 1 unit of base = rate units of quote. */
export const FxRate = z.object({
  id: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  organizationId: Id,
  base: z.string().min(3).max(3),
  quote: z.string().min(3).max(3),
  rate: z.number().positive(),
  asOf: z.string().min(8).max(30),
  source: z.string().max(120).default("manual"),
});
export type FxRate = z.infer<typeof FxRate>;

/**
 * Latest recorded rate from `from` to `to` (direct or inverse). Returns null
 * when no rate is recorded — translation is refused, never guessed.
 */
export function latestRate(rates: FxRate[], from: string, to: string): number | null {
  if (from === to) return 1;
  const pick = (b: string, q: string) =>
    rates.filter((r) => r.base === b && r.quote === q).sort((a, x) => x.asOf.localeCompare(a.asOf))[0];
  const direct = pick(from, to);
  if (direct) return direct.rate;
  const inverse = pick(to, from);
  return inverse ? Math.round((1 / inverse.rate) * 1e8) / 1e8 : null;
}

export interface PayrollLine {
  employee: string;
  gross: number;
  employerContribution: number;
  totalCost: number;
}

/** Simplified payroll run: gross + employer contribution at the engine's standard rate. */
export function runPayroll(engine: JurisdictionEngine, staff: { name: string; gross: number }[]): {
  lines: PayrollLine[];
  totals: { gross: number; employerContribution: number; totalCost: number };
} {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const lines = staff.map((p) => {
    const employerContribution = r2(p.gross * engine.payroll.employerRate);
    return { employee: p.name, gross: r2(p.gross), employerContribution, totalCost: r2(p.gross + employerContribution) };
  });
  const totals = {
    gross: r2(lines.reduce((n, l) => n + l.gross, 0)),
    employerContribution: r2(lines.reduce((n, l) => n + l.employerContribution, 0)),
    totalCost: r2(lines.reduce((n, l) => n + l.totalCost, 0)),
  };
  return { lines, totals };
}

export interface AnomalyFinding {
  severity: "warning" | "recommendation";
  code: string;
  message: string;
  entryIds: string[];
}

/** Continuous monitoring: pure checks over the ledger — never guesses. */
export function detectAnomalies(engine: JurisdictionEngine, entries: JournalEntry[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];

  const byRef = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    if (!e.reference) continue;
    const key = `${e.source}:${e.reference}`;
    byRef.set(key, [...(byRef.get(key) ?? []), e]);
  }
  for (const [key, dupes] of byRef) {
    if (dupes.length > 1) {
      findings.push({ severity: "warning", code: "duplicate_reference", message: `Reference ${key.split(":")[1]} appears in ${dupes.length} entries — possible duplicate.`, entryIds: dupes.map((d) => d.id) });
    }
  }

  if (engine.vatRate !== null) {
    for (const e of entries) {
      if (e.source !== "invoice") continue;
      const revenue = e.lines.filter((l) => l.accountCode.startsWith("4")).reduce((n, l) => n + l.credit - l.debit, 0);
      const vat = e.lines.filter((l) => l.accountCode === "2200").reduce((n, l) => n + l.credit - l.debit, 0);
      if (revenue > 0) {
        const expected = revenue * engine.vatRate;
        if (Math.abs(vat - expected) > Math.max(0.5, expected * 0.02)) {
          findings.push({ severity: "warning", code: "vat_mismatch", message: `Entry ${e.reference ?? e.id}: recorded ${engine.vatName} ${vat.toFixed(2)} differs from expected ${expected.toFixed(2)} (${(engine.vatRate * 100).toFixed(0)}% of ${revenue.toFixed(2)}).`, entryIds: [e.id] });
        }
      }
    }
  }

  const tb = trialBalance(engine, entries);
  const drift = tb.reduce((n, a) => n + a.debit, 0) - tb.reduce((n, a) => n + a.credit, 0);
  if (Math.abs(drift) > 0.005) {
    findings.push({ severity: "warning", code: "ledger_out_of_balance", message: `Ledger debits and credits differ by ${drift.toFixed(2)} — reconciliation required.`, entryIds: [] });
  }

  const fixed = tb.find((a) => a.code === "1500");
  if (fixed && fixed.balance > 0 && !entries.some((e) => e.source === "adjustment")) {
    findings.push({ severity: "recommendation", code: "depreciation_review", message: "Fixed assets carry a balance but no adjustment entries exist — review the depreciation schedule.", entryIds: [] });
  }
  return findings;
}
