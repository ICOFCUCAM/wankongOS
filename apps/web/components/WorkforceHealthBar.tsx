import type { WorkforceHealth } from "@/lib/server-api";

function money(n: number): string {
  return n === 0 ? "$0" : `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
}

function healthTone(score: number): string {
  if (score >= 85) return "text-success";
  if (score >= 60) return "text-warn";
  return "text-danger";
}

/**
 * The command center header: how the company is doing right now, in one
 * band. Company health is a disclosed formula (shown on hover) — every
 * other number is a direct count from stored records.
 */
export function WorkforceHealthBar({ health }: { health: WorkforceHealth }) {
  const h = health;
  return (
    <div className="card !p-0">
      <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-y-0 lg:grid-cols-8 lg:divide-x">
        <Cell label="AI Employees" value={h.employees} sub={`${h.activeEmployees} active`} />
        <Cell label="Active Tasks" value={h.activeTasks} sub={`${h.completedToday} done today`} />
        <Cell label="Departments" value={h.departments} />
        <Cell label="Workflows" value={h.runningWorkflows} sub="running" />
        <Cell
          label="Company Health"
          value={`${h.companyHealth.score}%`}
          tone={healthTone(h.companyHealth.score)}
          title={h.companyHealth.formula}
        />
        <Cell
          label="Avg Response"
          value={h.avgResponseMs === null ? "—" : `${(h.avgResponseMs / 1000).toFixed(1)}s`}
        />
        <Cell label="AI Cost Today" value={money(h.costTodayUsd)} />
        <Cell
          label="Approvals"
          value={h.pendingApprovals}
          sub="pending"
          tone={h.pendingApprovals > 0 ? "text-approval" : undefined}
        />
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: string;
  title?: string;
}) {
  return (
    <div className="px-4 py-3.5" title={title}>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold leading-none ${tone ?? ""}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
