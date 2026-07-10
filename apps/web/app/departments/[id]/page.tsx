import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EmployeeLiveCard } from "@/components/EmployeeLiveCard";

export const dynamic = "force-dynamic";

function money(n: number): string {
  return n === 0 ? "$0" : `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
}

const HEALTH_PILL: Record<string, string> = {
  healthy: "border-success/40 text-success",
  busy: "border-warn/50 text-warn",
  attention: "border-danger/50 text-danger",
};

/**
 * The department workspace (Level 5): one department as a running unit —
 * live headline, member mini-dashboards, and the department's own task
 * board slice. Numbers come from workforce health + summaries; the token
 * budget is the sum of members' real daily budgets.
 */
export default async function DepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let departments;
  let health;
  let summaries;
  let employees;
  let tasks;
  try {
    [departments, health, summaries, employees, tasks] = await Promise.all([
      api.departments(),
      api.workforceHealth(),
      api.employeeSummaries(),
      api.employees(),
      api.tasks(),
    ]);
  } catch {
    return <ApiDownNotice />;
  }

  const dept = departments.find((d) => d.id === id);
  const pulse = health.departmentsDetail.find((d) => d.departmentId === id);
  if (!dept) notFound();

  const members = summaries.filter((s) => s.departmentId === id);
  const memberIds = new Set(members.map((m) => m.employeeId));
  const deptTasks = tasks
    .filter((t) => t.assignee?.kind === "employee" && memberIds.has(t.assignee.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const openTasks = deptTasks.filter((t) => !["done", "cancelled"].includes(t.status));
  const budget = employees
    .filter((e) => e.departmentId === id)
    .reduce((n, e) => n + (e.dailyTokenBudget ?? 0), 0);
  const nameOf = new Map(members.map((m) => [m.employeeId, m.name]));

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={12} />
      <Link href="/employees" className="text-sm text-muted hover:text-text">
        ← Command center
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{dept.name}</h1>
        {pulse && (
          <span className={`pill ${HEALTH_PILL[pulse.health]}`}>
            {pulse.health === "attention" ? "needs attention" : pulse.health}
          </span>
        )}
        <Link href={`/employees/new?departmentId=${id}`} className="btn ml-auto shrink-0">
          + Hire into {dept.name}
        </Link>
      </div>
      {dept.description && <p className="max-w-2xl text-sm text-muted">{dept.description}</p>}

      <div className="card !p-0">
        <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-5 sm:divide-y-0 sm:divide-x">
          <Stat label="AI Employees" value={members.length} />
          <Stat label="Done Today" value={pulse?.completedToday ?? 0} />
          <Stat label="Open Tasks" value={openTasks.length} />
          <Stat label="Cost Today" value={money(pulse?.costTodayUsd ?? 0)} />
          <Stat
            label="Daily Token Budget"
            value={budget > 0 ? budget.toLocaleString() : "unlimited"}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {members.map((s) => (
            <EmployeeLiveCard key={s.employeeId} summary={s} />
          ))}
        </div>

        <div className="card self-start lg:sticky lg:top-8">
          <h2 className="mb-3 font-medium">Department tasks</h2>
          {deptTasks.length === 0 ? (
            <p className="text-sm text-muted">No tasks yet.</p>
          ) : (
            <ul className="space-y-2">
              {deptTasks.slice(0, 10).map((t) => (
                <li key={t.id} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{t.title}</span>
                    <span
                      className={`pill shrink-0 text-[10px] ${
                        t.status === "done"
                          ? "text-success"
                          : t.status === "blocked"
                            ? "text-danger"
                            : t.status === "in_progress"
                              ? "text-info"
                              : "text-muted"
                      }`}
                    >
                      {t.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {t.assignee ? (nameOf.get(t.assignee.id) ?? "—") : "unassigned"}
                    {typeof t.progress === "number" && t.status === "in_progress"
                      ? ` · ${Math.round(t.progress * 100)}%`
                      : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold leading-tight">{value}</div>
    </div>
  );
}
