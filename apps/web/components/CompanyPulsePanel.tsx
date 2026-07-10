import type { WorkforceHealth } from "@/lib/server-api";
import { activityStyle } from "@/lib/activity";

/**
 * Operational health at a glance (replaces the static org chart in the
 * command center's side panel): activity bars per department — sized by
 * open + completed-today tasks — and the live queue of employee presence
 * states. Everything from /v1/workforce/health.
 */
function Ledger({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="px-2 py-1.5 text-center">
      <div className={`text-sm font-semibold leading-tight ${tone ?? ""}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

export function CompanyPulsePanel({ health }: { health: WorkforceHealth }) {
  const depts = health.departmentsDetail;
  const magnitude = (d: (typeof depts)[number]) => d.openTasks + d.completedToday;
  const max = Math.max(1, ...depts.map(magnitude));
  const queue = [
    { label: "Running", value: health.liveQueue.running, style: activityStyle("working") },
    { label: "Waiting", value: health.liveQueue.waiting, style: activityStyle("waiting") },
    {
      label: "Approval needed",
      value: health.liveQueue.needsApproval,
      style: activityStyle("needs_approval"),
    },
    { label: "Blocked", value: health.liveQueue.blocked, style: activityStyle("blocked") },
  ];

  return (
    <div className="card space-y-5">
      <div>
        <h2 className="mb-3 font-medium">Today</h2>
        <div className="grid grid-cols-5 divide-x divide-border rounded-lg border border-border bg-surface-2/60">
          <Ledger label="Completed" value={health.tasksToday.completed} tone="text-success" />
          <Ledger label="Running" value={health.tasksToday.running} />
          <Ledger label="Waiting" value={health.tasksToday.queued} />
          <Ledger
            label="Approval"
            value={health.liveQueue.needsApproval}
            tone={health.liveQueue.needsApproval > 0 ? "text-approval" : undefined}
          />
          <Ledger
            label="Blocked"
            value={health.tasksToday.blocked}
            tone={health.tasksToday.blocked > 0 ? "text-danger" : undefined}
          />
        </div>
        <p className="mt-2 text-xs text-muted" title={health.valueDelivered.formula}>
          Est. value delivered today:{" "}
          <span className="font-mono text-text/90">
            ${health.valueDelivered.estUsd.toLocaleString()}
          </span>{" "}
          <span className="text-muted/70">(estimate — hover for formula)</span>
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <h2 className="mb-3 font-medium">Company pulse</h2>
        <div className="space-y-2.5">
          {depts.map((d) => (
            <a key={d.departmentId} href={`/departments/${d.departmentId}`} className="block group">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted group-hover:text-text">{d.name}</span>
                <span className="font-mono text-muted">
                  {d.completedToday > 0 ? `${d.completedToday} done · ` : ""}
                  {d.openTasks} open
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`bar-fill h-full rounded-full ${
                    d.health === "attention"
                      ? "bg-danger"
                      : d.health === "busy"
                        ? "bg-warn"
                        : "bg-accent"
                  }`}
                  style={{ width: `${Math.max(6, Math.round((magnitude(d) / max) * 100))}%` }}
                />
              </div>
            </a>
          ))}
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="mb-3 text-xs uppercase tracking-wide text-muted">Live queue</h3>
        <div className="grid grid-cols-2 gap-2.5">
          {queue.map((q) => (
            <div
              key={q.label}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${q.style.dot} ${q.value > 0 && q.style.live ? "live-dot" : ""}`}
              />
              <span className="text-lg font-semibold leading-none">{q.value}</span>
              <span className="text-[11px] leading-tight text-muted">{q.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
