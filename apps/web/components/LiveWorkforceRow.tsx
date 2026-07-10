import Link from "next/link";
import type { EmployeeSummary } from "@/lib/server-api";
import { activityStyle, ACTIVITY_ORDER, type ActivityStatus } from "@/lib/activity";
import { Avatar } from "./Avatar";

/**
 * A one-line answer to "who is doing what right now": every employee as an
 * avatar with its live status dot, ordered most-active-first, plus what the
 * busiest ones are working on. All derived from stored tasks and approvals.
 */
export function LiveWorkforceRow({ summaries }: { summaries: EmployeeSummary[] }) {
  const rank = new Map(ACTIVITY_ORDER.map((s, i) => [s, i]));
  const ordered = [...summaries].sort(
    (a, b) =>
      (rank.get(a.activity as ActivityStatus) ?? 9) - (rank.get(b.activity as ActivityStatus) ?? 9),
  );
  const working = ordered.filter((s) => s.activity === "working");

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">Workforce right now</h2>
        <Link href="/employees" className="text-xs text-accent-soft hover:underline">
          Open workforce →
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {ordered.map((s) => {
          const style = activityStyle(s.activity);
          return (
            <div key={s.employeeId} className="group relative">
              <Link
                href={`/employees/${s.employeeId}`}
                className="block transition group-hover:scale-105"
              >
                <Avatar name={s.name} size={36} role={s.title} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface ${style.dot} ${style.live ? "live-dot" : ""}`}
                />
              </Link>
              {/* Hover card: who, what, how far — with the workspace one click away. */}
              <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-xl border border-border bg-surface-2 p-3 opacity-0 shadow-xl transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{s.name}</span>
                  <span className={`shrink-0 text-xs font-medium ${style.text}`}>{style.label}</span>
                </div>
                <div className="truncate text-xs text-muted">{s.title}</div>
                {s.currentTask ? (
                  <div className="mt-2">
                    <div className="truncate text-xs text-text/90">▸ {s.currentTask.title}</div>
                    {s.currentTask.progress !== null && (
                      <div className="mt-1 flex items-center gap-2">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface">
                          <span
                            className="bar-fill block h-full rounded-full bg-accent"
                            style={{ width: `${Math.round(s.currentTask.progress * 100)}%` }}
                          />
                        </span>
                        <span className="font-mono text-[10px] text-muted">
                          {Math.round(s.currentTask.progress * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted">
                    {s.openTasks > 0 ? `${s.openTasks} task(s) queued` : "Nothing in flight"}
                  </div>
                )}
                <Link
                  href={`/employees/${s.employeeId}`}
                  className="mt-2 block text-xs font-medium text-accent-soft hover:underline"
                >
                  Open workspace →
                </Link>
              </div>
            </div>
          );
        })}
      </div>
      {working.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-sm">
          {working.slice(0, 4).map((s) => (
            <li key={s.employeeId} className="flex items-center gap-2 text-muted">
              <span className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
              <span className="text-text">{s.name}</span>
              {s.currentTask && (
                <>
                  <span className="truncate">— {s.currentTask.title}</span>
                  {s.currentTask.progress !== null && (
                    <span className="ml-auto shrink-0 font-mono text-xs">
                      {Math.round(s.currentTask.progress * 100)}%
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
