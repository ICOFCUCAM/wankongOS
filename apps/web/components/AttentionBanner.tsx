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
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-warn/40 bg-warn/5 px-5 py-3.5">
      <span className="text-sm font-semibold text-warn">Needs your attention</span>
      {pendingApprovals > 0 && (
        <Link href="/tasks" className="text-sm text-text hover:text-warn">
          {pendingApprovals} approval{pendingApprovals === 1 ? "" : "s"} waiting on you →
        </Link>
      )}
      {blocked.map((s) => (
        <Link
          key={s.employeeId}
          href={`/employees/${s.employeeId}`}
          className="text-sm text-text hover:text-danger"
        >
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-danger align-middle" />
          {s.name} is blocked{s.currentTask ? ` on “${s.currentTask.title}”` : ""} →
        </Link>
      ))}
    </div>
  );
}
