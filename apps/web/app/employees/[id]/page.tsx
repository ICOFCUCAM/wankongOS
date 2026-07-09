import Link from "next/link";
import { notFound } from "next/navigation";
import type { Employee, Goal } from "@wankong/core";
import { api, ApiError } from "@/lib/server-api";
import { Avatar } from "@/components/Avatar";
import { Chat } from "@/components/Chat";
import { EvalPanel } from "@/components/EvalPanel";
import { EmployeeControls } from "@/components/EmployeeControls";
import { ReviewPanel } from "@/components/ReviewPanel";

export const dynamic = "force-dynamic";

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">{title}</h3>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent-soft" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let employee: Employee;
  let goals: Goal[];
  let memories: Awaited<ReturnType<typeof api.employeeMemories>>;
  let evals: Awaited<ReturnType<typeof api.employeeEvals>>;
  let usage: Awaited<ReturnType<typeof api.employeeUsage>>;
  let reviews: Awaited<ReturnType<typeof api.employeeReviews>>;
  try {
    [employee, goals, memories, evals, usage, reviews] = await Promise.all([
      api.employee(id),
      api.employeeGoals(id),
      api.employeeMemories(id),
      api.employeeEvals(id),
      api.employeeUsage(id),
      api.employeeReviews(id),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  return (
    <div className="space-y-6">
      <Link href="/employees" className="text-sm text-muted hover:text-text">
        ← All employees
      </Link>

      <div className="flex items-start gap-4">
        <Avatar name={employee.name} size={64} />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{employee.name}</h1>
            <span
              className={`pill ${
                employee.status === "active"
                  ? "border-success/40 text-success"
                  : employee.status === "training"
                    ? "border-warn/50 text-warn"
                    : "text-muted"
              }`}
            >
              {employee.status === "training" ? "probation" : employee.status}
            </span>
            <EmployeeControls employeeId={employee.id} status={employee.status} />
          </div>
          <p className="text-muted">{employee.title}</p>
          <p className="mt-3 max-w-2xl text-sm text-muted">{employee.description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <div className="card grid grid-cols-1 gap-6 sm:grid-cols-2">
            <List title="Responsibilities" items={employee.responsibilities} />
            <List title="Objectives" items={employee.objectives} />
          </div>

          {employee.kpis.length > 0 && (
            <div className="card">
              <h3 className="mb-3 text-xs uppercase tracking-wide text-muted">KPIs</h3>
              <div className="grid grid-cols-2 gap-3">
                {employee.kpis.map((k) => (
                  <div key={k.key} className="rounded-lg border border-border bg-surface-2 p-3">
                    <div className="text-sm font-medium">{k.label}</div>
                    <div className="text-xs text-muted">
                      target {k.target}
                      {k.unit ? ` ${k.unit}` : ""} ·{" "}
                      {k.direction === "higher_is_better" ? "↑ better" : "↓ better"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {goals.length > 0 && (
            <div className="card">
              <h3 className="mb-3 text-xs uppercase tracking-wide text-muted">Goals</h3>
              <div className="space-y-3">
                {goals.map((g) => (
                  <div key={g.id}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{g.title}</span>
                      <span className="text-muted">{Math.round(g.progress * 100)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={`h-full rounded-full ${
                          g.status === "at_risk"
                            ? "bg-warn"
                            : g.status === "off_track"
                              ? "bg-danger"
                              : "bg-success"
                        }`}
                        style={{ width: `${Math.round(g.progress * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <EvalPanel employeeId={employee.id} suite={evals.suite} initialReports={evals.reports} />

          <ReviewPanel employeeId={employee.id} initialReviews={reviews} />

          <div className="card">
            <h3 className="mb-3 text-xs uppercase tracking-wide text-muted">Memory timeline</h3>
            {memories.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing remembered yet — memories form as this employee works.
              </p>
            ) : (
              <ul className="space-y-2">
                {memories.slice(0, 6).map((m) => (
                  <li
                    key={m.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2"
                  >
                    <div>
                      <div className="text-xs">{m.content}</div>
                      <div className="mt-0.5 text-[11px] text-muted">
                        {m.kind} · {new Date(m.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <span className="pill shrink-0 text-[11px] text-muted">
                      salience {m.score.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="card">
              <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Tools</h3>
              <div className="flex flex-wrap gap-1.5">
                {employee.toolIds.length === 0 ? (
                  <span className="text-sm text-muted">None</span>
                ) : (
                  employee.toolIds.map((t) => (
                    <span key={t} className="pill font-mono text-muted">
                      {t}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div className="card">
              <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Governance</h3>
              <div className="space-y-1.5 text-xs text-muted">
                <div>{employee.approvalRules.length} approval rule(s)</div>
                <div>{employee.escalationRules.length} escalation rule(s)</div>
                <div>{employee.permissions.length} permission(s)</div>
                <div>Provider: {employee.provider ?? "org default"}</div>
                <div>
                  Token budget:{" "}
                  {usage.dailyTokenBudget
                    ? `${usage.todayTokens.toLocaleString()} / ${usage.dailyTokenBudget.toLocaleString()} today`
                    : `unlimited (${usage.todayTokens.toLocaleString()} used today)`}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card flex h-[640px] flex-col lg:sticky lg:top-8 lg:self-start">
          <Chat employeeId={employee.id} employeeName={employee.name} />
        </div>
      </div>
    </div>
  );
}
