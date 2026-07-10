import Link from "next/link";
import type { EmployeeSummary } from "@/lib/server-api";

/**
 * The one thing a busy owner must see first (visual hierarchy, Problem 1):
 * items that need a human — pending approvals and blocked employees — get a
 * single high-contrast banner at the top of the dashboard. Renders nothing
 * when nothing needs attention, so calm days stay calm.
 */
export function AttentionBanner({
  pendingApprovals,
  summaries,
}: {
  pendingApprovals: number;
  summaries: EmployeeSummary[];
}) {
  const blocked = summaries.filter((s) => s.activity === "blocked");
  if (pendingApprovals === 0 && blocked.length === 0) return null;

  return (
    <div className="rounded-xl border border-warn/50 border-l-4 border-l-warn bg-warn/5 px-5 py-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-warn">
        <span>⚠</span> Needs Your Attention
        <span className="pill ml-1 border-warn/50 text-warn">
          {pendingApprovals + blocked.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {pendingApprovals > 0 && (
          <li className="flex items-center justify-between gap-3 text-sm">
            <span className="text-text">
              {pendingApprovals} approval{pendingApprovals === 1 ? "" : "s"} waiting on your decision
            </span>
            <Link href="/tasks" className="shrink-0 text-xs font-medium text-warn hover:underline">
              Review →
            </Link>
          </li>
        )}
        {blocked.map((s) => (
          <li key={s.employeeId} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-text">
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-danger align-middle" />
              {s.name} is blocked
              {s.currentTask ? (
                <span className="text-muted"> — waiting on “{s.currentTask.title}”</span>
              ) : null}
            </span>
            <Link
              href={`/employees/${s.employeeId}`}
              className="shrink-0 text-xs font-medium text-danger hover:underline"
            >
              Review →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
