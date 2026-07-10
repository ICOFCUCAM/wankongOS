import { Hono } from "hono";
import { engineFor, ACCOUNTING_SAFEGUARD, type JournalEntry, type JurisdictionEngine } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize } from "../http.js";

/**
 * Structured tax-export formats — the first step from "filing-ready working
 * papers" toward the official file formats tax authorities actually accept.
 * Both exports are generated ENTIRELY from recorded journal entries and are
 * honest about their limits: they are simplified subsets of the official
 * schemas, must be validated with the authority's own tools before
 * submission, and the system never submits anything itself.
 */

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function exportContext(ctx: Env["Variables"]["ctx"], companyId?: string) {
  const org = await ctx.store.organizations.get(ctx.organizationId);
  let engine: JurisdictionEngine = engineFor(org?.settings.jurisdiction ?? "US") ?? engineFor("US")!;
  let companyName = org?.name ?? "Company";
  if (companyId) {
    const company = await ctx.store.companies.get(companyId);
    if (!company || company.organizationId !== ctx.organizationId) return null;
    engine = engineFor(company.jurisdiction) ?? engine;
    companyName = company.name;
  }
  const entries = await ctx.store.journalEntries.listByOrg(ctx.organizationId, (e) =>
    companyId ? e.companyId === companyId : true,
  );
  return { engine, companyName, entries };
}

function entriesForYear(entries: JournalEntry[], year: string): JournalEntry[] {
  return entries
    .filter((e) => e.date.startsWith(year))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export const accountingExportRoutes = new Hono<Env>();

/**
 * SAF-T Financial (simplified subset) — the OECD standard audit file,
 * mandatory on request in Norway (and used across Europe). Header +
 * GeneralLedgerAccounts + GeneralLedgerEntries from recorded entries.
 */
accountingExportRoutes.get("/accounting/exports/saf-t", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const ec = await exportContext(ctx, c.req.query("companyId") || undefined);
  if (!ec) return c.json({ error: "Unknown company" }, 404);
  const { engine, companyName, entries } = ec;
  if (!engine.filings.some((f) => f.id === "saf-t")) {
    return c.json(
      { error: `SAF-T is not a filing in the ${engine.country} rules package (${engine.code}). Switch jurisdiction or pass a companyId in a SAF-T jurisdiction.` },
      422,
    );
  }
  const year = c.req.query("year") ?? new Date().toISOString().slice(0, 4);
  const rows = entriesForYear(entries, year);
  const totalDebit = rows.reduce((n, e) => n + e.lines.reduce((m, l) => m + l.debit, 0), 0);
  const totalCredit = rows.reduce((n, e) => n + e.lines.reduce((m, l) => m + l.credit, 0), 0);

  const accountsXml = engine.chartOfAccounts
    .map(
      (a) =>
        `      <Account>\n        <AccountID>${a.code}</AccountID>\n        <AccountDescription>${xmlEscape(a.name)}</AccountDescription>\n        <AccountType>${a.type}</AccountType>\n      </Account>`,
    )
    .join("\n");
  const txXml = rows
    .map((e, i) => {
      const lines = e.lines
        .map(
          (l, j) =>
            `          <Line>\n            <RecordID>${i + 1}-${j + 1}</RecordID>\n            <AccountID>${l.accountCode}</AccountID>\n            <Description>${xmlEscape(l.description || e.memo)}</Description>\n            ${l.debit > 0 ? `<DebitAmount><Amount>${l.debit.toFixed(2)}</Amount></DebitAmount>` : `<CreditAmount><Amount>${l.credit.toFixed(2)}</Amount></CreditAmount>`}\n          </Line>`,
        )
        .join("\n");
      return `        <Transaction>\n          <TransactionID>${e.id}</TransactionID>\n          <TransactionDate>${e.date.slice(0, 10)}</TransactionDate>\n          <Description>${xmlEscape(e.memo)}</Description>\n          <SourceID>${xmlEscape(e.source)}</SourceID>\n${lines}\n        </Transaction>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Simplified SAF-T Financial subset generated from recorded journal entries.
     Validate with the tax authority's official tools before any submission.
     ${xmlEscape(ACCOUNTING_SAFEGUARD)} -->
<AuditFile xmlns="urn:StandardAuditFile-Taxation-Financial:NO">
  <Header>
    <AuditFileVersion>1.0 (simplified subset)</AuditFileVersion>
    <AuditFileDateCreated>${new Date().toISOString().slice(0, 10)}</AuditFileDateCreated>
    <SoftwareCompanyName>WankongOS</SoftwareCompanyName>
    <SoftwareID>wankongos-accounting</SoftwareID>
    <Company><Name>${xmlEscape(companyName)}</Name></Company>
    <DefaultCurrencyCode>${engine.currency}</DefaultCurrencyCode>
    <SelectionCriteria><PeriodStart>${year}-01</PeriodStart><PeriodEnd>${year}-12</PeriodEnd></SelectionCriteria>
  </Header>
  <MasterFiles>
    <GeneralLedgerAccounts>
${accountsXml}
    </GeneralLedgerAccounts>
  </MasterFiles>
  <GeneralLedgerEntries>
    <NumberOfEntries>${rows.length}</NumberOfEntries>
    <TotalDebit>${totalDebit.toFixed(2)}</TotalDebit>
    <TotalCredit>${totalCredit.toFixed(2)}</TotalCredit>
    <Journal>
      <JournalID>GL</JournalID>
      <Description>General ledger</Description>
${txXml}
    </Journal>
  </GeneralLedgerEntries>
</AuditFile>
`;
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "accounting.export.saf_t",
    metadata: { year, entries: rows.length, jurisdiction: engine.code },
  });
  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `attachment; filename="saf-t-${year}.xml"`,
    },
  });
});

/**
 * FEC (Fichier des Écritures Comptables) — France's mandatory audit file:
 * 18 pipe-separated columns, one row per journal line, dates as YYYYMMDD.
 * Lettering/auxiliary columns are empty (not modelled) — disclosed below.
 */
accountingExportRoutes.get("/accounting/exports/fec", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const ec = await exportContext(ctx, c.req.query("companyId") || undefined);
  if (!ec) return c.json({ error: "Unknown company" }, 404);
  const { engine, companyName, entries } = ec;
  if (engine.code !== "FR") {
    return c.json(
      { error: `FEC is the French audit file; the active rules package is ${engine.country} (${engine.code}). Switch jurisdiction or pass a French companyId.` },
      422,
    );
  }
  const year = c.req.query("year") ?? new Date().toISOString().slice(0, 4);
  const rows = entriesForYear(entries, year);
  const accountName = new Map(engine.chartOfAccounts.map((a) => [a.code, a.name]));

  const HEADER =
    "JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLet|DateLet|ValidDate|Montantdevise|Idevise";
  const fecDate = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
  const clean = (s: string) => s.replace(/\|/g, "/").replace(/\r?\n/g, " ");
  const body = rows.flatMap((e, i) =>
    e.lines.map((l) =>
      [
        e.source.toUpperCase().slice(0, 6), // JournalCode
        clean(e.source), // JournalLib
        String(i + 1), // EcritureNum
        fecDate(e.date), // EcritureDate
        l.accountCode, // CompteNum
        clean(accountName.get(l.accountCode) ?? l.description ?? ""), // CompteLib
        "", // CompAuxNum (not modelled)
        "", // CompAuxLib (not modelled)
        e.reference ?? e.id, // PieceRef
        fecDate(e.date), // PieceDate
        clean(e.memo || l.description || ""), // EcritureLib
        l.debit.toFixed(2).replace(".", ","), // Debit (French decimal comma)
        l.credit.toFixed(2).replace(".", ","), // Credit
        "", // EcritureLet (lettering not modelled)
        "", // DateLet
        fecDate(e.createdAt), // ValidDate
        "", // Montantdevise (single-currency ledger rows)
        "", // Idevise
      ].join("|"),
    ),
  );
  const fec = `${HEADER}\n${body.join("\n")}\n`;
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "accounting.export.fec",
    metadata: { year, rows: body.length, company: companyName },
  });
  return new Response(fec, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="FEC-${year}.txt"`,
      "x-safeguard": "Simplified FEC generated from recorded entries; auxiliary accounts and lettering are not modelled. Validate with the DGFiP test tool before submission.",
    },
  });
});
