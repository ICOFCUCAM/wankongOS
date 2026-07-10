import Link from "next/link";
import {
  api,
  type AnalyticsData,
  type EmployeeSummary,
  type WorkforceHealth,
} from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Avatar } from "@/components/Avatar";

export const dynamic = "force-dynamic";

function money(n: number): string {
  return n === 0 ? "$0" : `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
}

export default async function AnalyticsPage() {
  let data: AnalyticsData;
  let summaries: EmployeeSummary[];
  let health: WorkforceHealth;
  try {
    [data, summaries, health] = await Promise.all([
      api.analytics(),
      api.employeeSummaries(),
      api.workforceHealth(),
    ]);
  } catch {
    return (
      <div className="space-y-6">
        <Header />
        <ApiDownNotice />
      </div>
    );
  }

  const max = Math.max(1, ...data.perEmployee.map((r) => r.tokensIn + r.tokensOut));

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={30} />
      <Header />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Total label="AI Requests" value={data.totals.requests.toLocaleString()} />
        <Total label="Tokens In" value={data.totals.tokensIn.toLocaleString()} />
        <Total label="Tokens Out" value={data.totals.tokensOut.toLocaleString()} />
        <Total label="Est. Spend" value={money(data.totals.estCostUsd)} accent />
      </div>

      <Insights summaries={summaries} health={health} />

      <div className="card overflow-x-auto">
        <h2 className="mb-4 font-medium">Cost &amp; speed per employee</h2>
        {data.perEmployee.every((r) => r.requests === 0) ? (
          <p className="text-sm text-muted">
            No AI usage recorded yet — numbers appear as employees work.
          </p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="pb-2 pr-4 font-medium">Employee</th>
                <th className="pb-2 pr-4 font-medium">Requests</th>
                <th className="pb-2 pr-4 font-medium">Tokens</th>
                <th className="pb-2 pr-4 font-medium">Avg latency</th>
                <th className="pb-2 pr-4 font-medium">Today</th>
                <th className="pb-2 text-right font-medium">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {data.perEmployee.map((r) => {
                const tokens = r.tokensIn + r.tokensOut;
                return (
                  <tr key={r.employeeId} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 pr-4">
                      <Link
                        href={`/employees/${r.employeeId}`}
                        className="flex items-center gap-2.5 hover:text-accent-soft"
                      >
                        <Avatar name={r.name} size={28} />
                        <span>
                          <span className="block font-medium leading-tight">{r.name}</span>
                          <span className="block text-xs text-muted">{r.title}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4 font-mono">{r.requests}</td>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono">{tokens.toLocaleString()}</span>
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                          <span
                            className="bar-fill block h-full rounded-full bg-accent"
                            style={{ width: `${Math.round((tokens / max) * 100)}%` }}
                          />
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 font-mono">
                      {r.avgLatencyMs === null ? "—" : `${r.avgLatencyMs} ms`}
                    </td>
                    <td className="py-2.5 pr-4 font-mono">
                      {r.requestsToday > 0 ? `${r.requestsToday} req · ${money(r.costTodayUsd)}` : "—"}
                    </td>
                    <td className="py-2.5 text-right font-mono">{money(r.estCostUsd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-muted">{data.note}</p>
      </div>
    </div>
  );
}

/**
 * Level 10: superlatives and department productivity, all recomputed from
 * live summaries + workforce health on every view.
 */
function Insights({
  summaries,
  health,
}: {
  summaries: EmployeeSummary[];
  health: WorkforceHealth;
}) {
  const active = summaries.filter((s) => s.status === "active");
  const byOutput = [...active].sort(
    (a, b) => b.completedToday - a.completedToday || b.metrics.requests - a.metrics.requests,
  );
  const mostProductive = byOutput[0];
  const leastBusy = [...active].sort((a, b) => a.openTasks - b.openTasks)[0];
  const responders = active.filter((s) => s.metrics.avgLatencyMs !== null);
  const fastest = responders.sort(
    (a, b) => (a.metrics.avgLatencyMs ?? 0) - (b.metrics.avgLatencyMs ?? 0),
  )[0];
  const depts = health.departmentsDetail;
  const maxDone = Math.max(1, ...depts.map((d) => d.completedToday + d.openTasks));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="card">
        <h2 className="mb-3 font-medium">Department productivity</h2>
        <div className="space-y-2.5">
          {depts.map((d) => (
            <div key={d.departmentId}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-muted">{d.name}</span>
                <span className="font-mono text-muted">
                  {d.completedToday} done · {d.openTasks} open
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="bar-fill h-full rounded-full bg-accent"
                  style={{
                    width: `${Math.max(4, Math.round(((d.completedToday + d.openTasks) / maxDone) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h2 className="mb-3 font-medium">Insights</h2>
        <div className="space-y-2 text-sm">
          <Insight
            label="Most productive today"
            value={
              mostProductive && mostProductive.completedToday > 0
                ? `${mostProductive.name} — ${mostProductive.completedToday} done`
                : "no completions yet"
            }
          />
          <Insight
            label="Most available"
            value={leastBusy ? `${leastBusy.name} — ${leastBusy.openTasks} open` : "—"}
          />
          <Insight
            label="Fastest responder"
            value={
              fastest ? `${fastest.name} — ${fastest.metrics.avgLatencyMs} ms avg` : "no AI usage yet"
            }
          />
          <Insight
            label="AI cost today"
            value={money(health.costTodayUsd)}
          />
          <Insight
            label="Est. value delivered"
            value={`$${health.valueDelivered.estUsd.toLocaleString()} (estimate)`}
          />
        </div>
      </div>
    </div>
  );
}

function Insight({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border pb-2 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}

function Total({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${accent ? "text-accent-soft" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Analytics</h1>
      <p className="text-sm text-muted">
        Where AI spend and speed actually go, per employee — from recorded usage.
      </p>
    </div>
  );
}
