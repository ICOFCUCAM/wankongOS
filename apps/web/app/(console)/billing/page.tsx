import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  let b;
  try {
    b = await api.billing();
  } catch {
    return <ApiDownNotice />;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-muted">Plan, limits, and this month&apos;s metered usage — from records.</p>
      </div>
      <div className="card !p-0">
        <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
          <Cell label="Plan" value={b.plan.name} sub={`$${b.plan.priceUsdMonthly}/mo`} />
          <Cell label="Employees" value={`${b.usage.employees}/${b.usage.employeeLimit}`} />
          <Cell label="Tokens (month)" value={b.usage.monthTokens.toLocaleString()} />
          <Cell label="Est. AI cost" value={`$${b.usage.estAiCostUsd}`} />
        </div>
      </div>
      <div className="card">
        <h2 className="mb-2 font-medium">Plans</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {b.availablePlans.map((p) => (
            <div key={p.id} className={`rounded-lg border px-3 py-2 text-sm ${p.id === b.plan.id ? "border-accent bg-accent/5" : "border-border"}`}>
              <div className="flex justify-between">
                <span className="font-medium">{p.name}</span>
                <span className="font-mono text-xs text-muted">${p.priceUsdMonthly}/mo</span>
              </div>
              <p className="text-xs text-muted">
                up to {p.maxEmployees.toLocaleString()} employees
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{b.invoicePreview.note}</p>
      </div>
      <div className="card">
        <h2 className="mb-1 font-medium">Recorded revenue</h2>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold">
            ${b.recordedRevenue.monthUsd.toLocaleString()}
          </span>
          <span className="text-xs text-muted">
            this month · {b.recordedRevenue.entries}{" "}
            {b.recordedRevenue.entries === 1 ? "ledger entry" : "ledger entries"}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted">{b.recordedRevenue.note}</p>
      </div>
    </div>
  );
}

function Cell({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
