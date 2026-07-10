import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

/** Global Accounting & Compliance: the official books, the active
 * jurisdiction engine, derived statements, and continuous monitoring. */
export default async function AccountingPage() {
  let engine;
  let statements;
  let anomalies;
  try {
    [engine, statements, anomalies] = await Promise.all([
      api.accountingEngine(),
      api.accountingStatements(),
      api.accountingAnomalies(),
    ]);
  } catch {
    return <ApiDownNotice />;
  }
  const e = engine.engine;
  const money = (n: number) => `${n.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${statements.currency}`;

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={20} />
      <div>
        <h1 className="text-2xl font-semibold">Global Accounting &amp; Compliance</h1>
        <p className="text-sm text-muted">
          The official books under the {e.country} engine — statements derive live from the ledger.
        </p>
      </div>

      <div className="card !p-0">
        <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-5 sm:divide-y-0 sm:divide-x">
          <Cell label="Jurisdiction" value={e.country} sub={e.code} />
          <Cell label="Standard" value={e.standard.split("(")[0]!.trim()} sub={e.standard} />
          <Cell label={e.vatName} value={e.vatRate === null ? "sub-national" : `${Math.round(e.vatRate * 100)}%`} />
          <Cell label="Currency" value={e.currency} sub={`filings in ${e.language}`} />
          <Cell label="Filings" value={e.filings.length} sub={e.filings.map((f) => f.name).join(" · ")} />
        </div>
      </div>

      {anomalies.length > 0 && (
        <div className="card border-warn/40">
          <h2 className="mb-2 font-medium text-warn">Monitoring findings</h2>
          <ul className="space-y-1.5 text-sm">
            {anomalies.map((f, i) => (
              <li key={i} className="flex gap-2">
                <span className={f.severity === "warning" ? "text-danger" : "text-info"}>
                  {f.severity === "warning" ? "⚠" : "→"}
                </span>
                <span className="text-text/90">{f.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-medium">Profit &amp; loss</h2>
          <Row label="Revenue" value={money(statements.profitAndLoss.revenue)} />
          <Row label="Expenses" value={money(statements.profitAndLoss.expenses)} />
          <Row label="Net income" value={money(statements.profitAndLoss.netIncome)} strong />
        </div>
        <div className="card">
          <h2 className="mb-3 font-medium">Balance sheet</h2>
          <Row label="Assets" value={money(statements.balanceSheet.assets)} />
          <Row label="Liabilities" value={money(statements.balanceSheet.liabilities)} />
          <Row label="Equity (incl. net income)" value={money(statements.balanceSheet.equity)} strong />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-3 font-medium">Trial balance</h2>
        {statements.trialBalance.every((a) => a.debit === 0 && a.credit === 0) ? (
          <p className="text-sm text-muted">
            No entries posted yet — the ledger fills as the department records transactions.
          </p>
        ) : (
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="pb-2 pr-4">Code</th><th className="pb-2 pr-4">Account</th>
                <th className="pb-2 pr-4 text-right">Debit</th><th className="pb-2 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {statements.trialBalance.filter((a) => a.debit !== 0 || a.credit !== 0).map((a) => (
                <tr key={a.code} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-4 font-mono text-xs">{a.code}</td>
                  <td className="py-1.5 pr-4">{a.name}</td>
                  <td className="py-1.5 pr-4 text-right font-mono">{a.debit.toFixed(2)}</td>
                  <td className="py-1.5 text-right font-mono">{a.credit.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-muted">{engine.safeguard}</p>
    </div>
  );
}

function Cell({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="px-4 py-3" title={sub}>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold leading-tight">{value}</div>
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between border-b border-border py-1.5 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className={`font-mono ${strong ? "font-semibold text-accent-soft" : ""}`}>{value}</span>
    </div>
  );
}
