import Link from "next/link";
import type { EmployeeSummary } from "@/lib/server-api";
import { activityStyle } from "@/lib/activity";
import { Avatar } from "./Avatar";
import { EmployeeCardActions } from "./EmployeeCardActions";

/**
 * A living employee card: everything on it is derived from stored records —
 * activity from tasks + approvals, progress from the task itself, output and
 * cost from today's completions and recorded token usage, confidence from
 * eval reports. Nothing here is simulated.
 */
export function EmployeeLiveCard({ summary }: { summary: EmployeeSummary }) {
  const s = activityStyle(summary.activity);
  const cost = summary.metrics.estCostUsd;

  return (
    <div className="card flex flex-col gap-3 transition hover:border-accent/60">
      <Link href={`/employees/${summary.employeeId}`} className="group flex items-start gap-3">
        <div className="relative">
          <Avatar name={summary.name} size={44} />
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface ${s.dot} ${s.live ? "live-dot" : ""}`}
            title={s.label}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate font-medium group-hover:text-accent-soft">{summary.name}</div>
            <span className={`text-xs font-medium ${s.text}`}>{s.label}</span>
          </div>
          <div className="truncate text-sm text-muted">{summary.title}</div>
        </div>
      </Link>

      {summary.currentTask ? (
        <div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-text/90">▸ {summary.currentTask.title}</span>
            {summary.currentTask.progress !== null && (
              <span className="shrink-0 font-mono text-muted">
                {Math.round(summary.currentTask.progress * 100)}%
              </span>
            )}
          </div>
          {summary.currentTask.progress !== null && (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.round(summary.currentTask.progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted">
          {summary.activity === "offline" ? "Not on shift." : "No task in progress."}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-2.5 text-xs text-muted">
        <Stat label="done today" value={summary.completedToday} />
        <Stat label="open" value={summary.openTasks} />
        {summary.waitingApprovals > 0 && (
          <span className="text-warn">
            {summary.waitingApprovals} awaiting approval
          </span>
        )}
        <span className="ml-auto font-mono">
          {cost > 0 ? `$${cost.toFixed(cost < 0.1 ? 4 : 2)}` : "$0"}
        </span>
      </div>

      {summary.confidence !== null && (
        <div className="flex items-center gap-2 text-xs text-muted" title="Average eval pass rate">
          <span>confidence</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full ${summary.confidence >= 0.8 ? "bg-success" : summary.confidence >= 0.5 ? "bg-warn" : "bg-danger"}`}
              style={{ width: `${Math.round(summary.confidence * 100)}%` }}
            />
          </div>
          <span className="font-mono">{Math.round(summary.confidence * 100)}%</span>
        </div>
      )}

      <EmployeeCardActions employeeId={summary.employeeId} status={summary.status} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <span className="font-mono text-text/90">{value}</span> {label}
    </span>
  );
}
