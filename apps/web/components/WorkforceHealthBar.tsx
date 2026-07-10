import Link from "next/link";
import { CountUp } from "./CountUp";
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
 * other number is a direct count from stored records. Cells deep-link to
 * the surface where that number can be acted on.
 */
export function WorkforceHealthBar({ health }: { health: WorkforceHealth }) {
  const h = health;
  return (
    <div className="card !p-0">
      <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-y-0 lg:grid-cols-9 lg:divide-x">
        <Cell
          label="AI Employees"
          value={h.employees}
          sub={`${h.activeEmployees} active`}
          href="/employees"
        />
        <Cell
          label="Active Tasks"
          value={h.activeTasks}
          sub={`${h.completedToday} done today`}
          href="/tasks"
        />
        <Cell label="Departments" value={h.departments} href="/employees" />
        <Cell label="Workflows" value={h.runningWorkflows} sub="running" href="/workflows" />
        <div
          className="col-span-2 row-span-1 border-l-2 border-l-accent/60 bg-surface-2/40 px-4 py-3"
          title={h.companyHealth.formula}
        >
          <div className="text-[11px] uppercase tracking-wide text-muted">Company Health</div>
          <div className="flex items-baseline gap-2">
            <span className={`text-4xl font-bold leading-none ${healthTone(h.companyHealth.score)}`}>
              <CountUp value={h.companyHealth.score} suffix="%" />
            </span>
            <span className={`text-xs font-medium ${healthTone(h.companyHealth.score)}`}>
              {h.companyHealth.score >= 85 ? "Excellent" : h.companyHealth.score >= 60 ? "Stable" : "Needs attention"}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`bar-fill h-full rounded-full ${h.companyHealth.score >= 85 ? "bg-success" : h.companyHealth.score >= 60 ? "bg-warn" : "bg-danger"}`}
              style={{ width: `${h.companyHealth.score}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] text-muted">formula on hover — derived, never a vibe</div>
        </div>
        <Cell
          label="Avg Response"
          value={h.avgResponseMs === null ? "—" : `${(h.avgResponseMs / 1000).toFixed(1)}s`}
          href="/analytics"
        />
        <Cell
          label="AI Cost Today"
          value={money(h.costTodayUsd)}
          sub={
            h.costTodayUsd > 0
              ? `run-rate ≈ ${money(Math.round((h.costTodayUsd / Math.max(0.04, new Date().getUTCHours() / 24 + new Date().getUTCMinutes() / 1440)) * 100) / 100)}/day (estimate)`
              : "spend appears as employees work"
          }
          href="/analytics"
        />
        <Cell
          label="Approvals"
          value={h.pendingApprovals}
          sub="pending"
          tone={h.pendingApprovals > 0 ? "text-approval" : undefined}
          href="/tasks"
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
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: string;
  title?: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold leading-none ${tone ?? ""}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted">{sub}</div>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="px-4 py-3.5 transition hover:bg-surface-2/60" title={title}>
        {body}
      </Link>
    );
  }
  return (
    <div className="px-4 py-3.5" title={title}>
      {body}
    </div>
  );
}
