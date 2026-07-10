import Link from "next/link";
import type { WorkforceHealth } from "@/lib/server-api";
import { ACTIVITY_ORDER, activityStyle, type ActivityStatus } from "@/lib/activity";

/** The verb a CEO reads per department, from its most urgent present state. */
const VERB: Record<ActivityStatus, string> = {
  blocked: "Blocked",
  needs_approval: "Needs approval",
  thinking: "Running",
  working: "Running",
  waiting: "Queued",
  learning: "Training",
  idle: "Standing by",
  offline: "Offline",
};

function dominant(byActivity: Partial<Record<ActivityStatus, number>>): ActivityStatus {
  for (const status of ACTIVITY_ORDER) if (byActivity[status]) return status;
  return "idle";
}

/**
 * Mission control (Level 4): every department as one line — name, live
 * verb, and a bar sized by open + done-today workload. Click through to
 * its container on the command center.
 */
export function DepartmentStatusList({ health }: { health: WorkforceHealth }) {
  const depts = health.departmentsDetail;
  const max = Math.max(1, ...depts.map((d) => d.openTasks + d.completedToday));
  return (
    <div className="card">
      <h2 className="mb-3 font-medium">Departments</h2>
      <ul className="space-y-2">
        {depts.map((d) => {
          const status = dominant(d.byActivity);
          const style = activityStyle(status);
          return (
            <li key={d.departmentId}>
              <Link
                href={`/employees#dept-${d.departmentId}`}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-surface-2"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${style.dot} ${style.live ? "live-dot" : ""}`}
                />
                <span className="w-40 truncate text-sm">{d.name}</span>
                <span className={`w-28 shrink-0 text-xs font-medium ${style.text}`}>
                  {VERB[status]}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="bar-fill block h-full rounded-full bg-accent"
                    style={{
                      width: `${Math.max(4, Math.round(((d.openTasks + d.completedToday) / max) * 100))}%`,
                    }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right font-mono text-xs text-muted">
                  {d.completedToday > 0 ? `${d.completedToday} done` : `${d.openTasks} open`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
