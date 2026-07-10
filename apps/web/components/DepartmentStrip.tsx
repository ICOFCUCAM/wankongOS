import type { Department } from "@wankong/core";
import type { EmployeeSummary } from "@/lib/server-api";
import { activityStyle, ACTIVITY_ORDER, type ActivityStatus } from "@/lib/activity";

/**
 * Department overview strip: one glanceable tile per department rolling up
 * its employees' derived activity — headcount, live status dots, output
 * today, and estimated spend. Answers "how is each part of my company
 * doing?" before the user reads a single card.
 */
export function DepartmentStrip({
  departments,
  summaries,
}: {
  departments: Department[];
  summaries: EmployeeSummary[];
}) {
  const tiles = departments
    .map((d) => {
      const people = summaries.filter((s) => s.departmentId === d.id);
      const byActivity = new Map<ActivityStatus, number>();
      for (const p of people) {
        const key = p.activity as ActivityStatus;
        byActivity.set(key, (byActivity.get(key) ?? 0) + 1);
      }
      return {
        dept: d,
        people,
        byActivity,
        completedToday: people.reduce((n, p) => n + p.completedToday, 0),
        estCostUsd: people.reduce((n, p) => n + p.metrics.estCostUsd, 0),
      };
    })
    .filter((t) => t.people.length > 0);

  if (tiles.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {tiles.map(({ dept, people, byActivity, completedToday, estCostUsd }) => (
        <a
          key={dept.id}
          href={`#dept-${dept.id}`}
          className="card !p-3.5 transition hover:border-accent"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-sm font-medium">{dept.name}</div>
            <span className="shrink-0 text-xs text-muted">{people.length}</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            {ACTIVITY_ORDER.map((status) => {
              const n = byActivity.get(status);
              if (!n) return null;
              const s = activityStyle(status);
              return (
                <span
                  key={status}
                  className="flex items-center gap-1 text-xs text-muted"
                  title={`${n} ${s.label.toLowerCase()}`}
                >
                  <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                  {n}
                </span>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>
              <span className="font-mono text-text/90">{completedToday}</span> done today
            </span>
            <span className="font-mono">
              {estCostUsd > 0 ? `$${estCostUsd.toFixed(estCostUsd < 0.1 ? 4 : 2)}` : "$0"}
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}
