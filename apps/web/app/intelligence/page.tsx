import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { IntelligencePanels } from "@/components/IntelligencePanels";

export const dynamic = "force-dynamic";

/**
 * Executive intelligence: the BI department and the Strategy Office. The
 * evidence pack below is deterministic (formulas disclosed); the AI answers
 * on top must cite it and name gaps — no invented figures anywhere.
 */
export default async function IntelligencePage() {
  let m;
  try {
    m = await api.intelligenceMetrics();
  } catch {
    return <ApiDownNotice />;
  }
  const latest = m.revenueByMonth.at(-1);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Intelligence</h1>
        <p className="text-sm text-muted">
          Executive questions and cross-functional plans, grounded in the company&apos;s own
          records.
        </p>
      </div>

      <IntelligencePanels />

      <div className="card">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">
          The evidence pack — what every answer stands on
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Recorded revenue (this month)" value={`$${latest?.recordedUsd.toLocaleString() ?? 0}`} />
          <Stat label="Company health" value={`${m.companyHealth.score}%`} />
          <Stat label="Staffed departments" value={m.departments.length} />
          <Stat label="Pending approvals" value={m.pendingApprovals} />
        </div>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="py-1 font-normal">Department</th>
              <th className="py-1 text-right font-normal">People</th>
              <th className="py-1 text-right font-normal">Open</th>
              <th className="py-1 text-right font-normal">Done 14d</th>
              <th className="py-1 text-right font-normal">vs prior 14d</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {m.departments.map((d) => (
              <tr key={d.name}>
                <td className="py-1.5">{d.name}</td>
                <td className="py-1.5 text-right">{d.employees}</td>
                <td className="py-1.5 text-right">{d.openTasks}</td>
                <td className="py-1.5 text-right">{d.completedLast14d}</td>
                <td className={`py-1.5 text-right ${d.deltaPct === null ? "text-muted" : d.deltaPct < 0 ? "text-danger" : "text-success"}`}>
                  {d.deltaPct === null ? "—" : `${d.deltaPct > 0 ? "+" : ""}${d.deltaPct}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 space-y-0.5">
          {m.formulas.map((f) => (
            <p key={f} className="text-[11px] text-muted">
              formula: {f}
            </p>
          ))}
          <p className="pt-1 text-[11px] text-muted">{m.limits}</p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}
