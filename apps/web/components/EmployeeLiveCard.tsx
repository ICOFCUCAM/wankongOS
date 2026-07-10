import Link from "next/link";
import type { EmployeeSummary } from "@/lib/server-api";
import { activityStyle } from "@/lib/activity";
import { Avatar } from "./Avatar";
import { EmployeeCardActions } from "./EmployeeCardActions";

function money(n: number): string {
  return n === 0 ? "$0" : `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
}

/**
 * A mini dashboard per employee: presence, the task in flight with real
 * progress, today's output / speed / success / cost, and who they report
 * to. Every value is derived from stored records (ADR-0018) — activity
 * from tasks + approvals + message recency, success from eval reports,
 * cost from recorded token usage. Actions reveal on hover (always visible
 * on touch layouts).
 */
export function EmployeeLiveCard({ summary }: { summary: EmployeeSummary }) {
  const s = activityStyle(summary.activity);
  const m = summary.metrics;
  const avgMs = m.avgLatencyTodayMs ?? m.avgLatencyMs;

  return (
    <div className="group/card card flex flex-col gap-3 !p-4 transition hover:border-accent/60">
      <Link href={`/employees/${summary.employeeId}`} className="group flex items-start gap-3">
        <div className="relative">
          <Avatar name={summary.name} size={42} />
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface ${s.dot} ${s.live ? "live-dot" : ""}`}
            title={s.label}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate font-medium group-hover:text-accent-soft">{summary.name}</div>
            <span className={`shrink-0 text-xs font-medium ${s.text}`}>{s.label}</span>
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
                className="bar-fill h-full rounded-full bg-accent"
                style={{ width: `${Math.round(summary.currentTask.progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted">
          {summary.activity === "offline"
            ? "Not on shift."
            : summary.activity === "waiting"
              ? `${summary.openTasks} task${summary.openTasks === 1 ? "" : "s"} queued.`
              : "No task in progress."}
        </div>
      )}

      <div className="grid grid-cols-4 divide-x divide-border rounded-lg border border-border bg-surface-2/60">
        <MiniStat label="Output" value={String(summary.completedToday)} sub="today" />
        <MiniStat
          label="Avg time"
          value={avgMs === null ? "—" : avgMs < 1000 ? `${avgMs}ms` : `${(avgMs / 1000).toFixed(1)}s`}
          sub="response"
        />
        <MiniStat
          label="Success"
          value={summary.confidence === null ? "—" : `${Math.round(summary.confidence * 100)}%`}
          sub="evals"
          tone={
            summary.confidence === null
              ? undefined
              : summary.confidence >= 0.8
                ? "text-success"
                : summary.confidence >= 0.5
                  ? "text-warn"
                  : "text-danger"
          }
        />
        <MiniStat label="Cost" value={money(m.costTodayUsd)} sub="today" />
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="truncate">
          Reports to <span className="text-text/90">{summary.reportsTo ?? "you (CEO)"}</span>
        </span>
        {summary.waitingApprovals > 0 && (
          <span className="shrink-0 text-approval">
            {summary.waitingApprovals} awaiting approval
          </span>
        )}
      </div>

      <div className="transition-opacity sm:opacity-0 sm:group-hover/card:opacity-100 sm:group-focus-within/card:opacity-100">
        <EmployeeCardActions employeeId={summary.employeeId} status={summary.status} />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="px-2 py-1.5 text-center">
      <div className={`text-sm font-semibold leading-tight ${tone ?? ""}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-[9px] text-muted/70">{sub}</div>
    </div>
  );
}
