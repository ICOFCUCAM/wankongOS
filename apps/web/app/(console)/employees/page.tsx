import Link from "next/link";
import type { Department } from "@wankong/core";
import {
  api,
  type EmployeeSummary,
  type PulseItem,
  type WorkforceHealth,
} from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { EmployeeLiveCard } from "@/components/EmployeeLiveCard";
import { DepartmentSection } from "@/components/DepartmentSection";
import { WorkforceHealthBar } from "@/components/WorkforceHealthBar";
import { CompanyPulsePanel } from "@/components/CompanyPulsePanel";
import { GoalsPanel } from "@/components/GoalsPanel";
import { CollaborationPanel } from "@/components/CollaborationPanel";
import { CompanyPulse } from "@/components/CompanyPulse";
import { AutoRefresh } from "@/components/AutoRefresh";
import { WorkforceControls } from "@/components/WorkforceControls";
import { CompanyStatusBanner } from "@/components/CompanyStatusBanner";

export const dynamic = "force-dynamic";

/**
 * The AI Workforce Command Center. Three questions, three bands:
 * what is happening now (health bar + live cards), how is the company
 * performing (department containers + pulse panel), what can I do next
 * (card actions, hire tiles, attention cues). Every value derives from
 * stored records — ADR-0018.
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  let summaries: EmployeeSummary[];
  let departments: Department[];
  let health: WorkforceHealth;
  let activity: PulseItem[];
  let goals: Awaited<ReturnType<typeof api.goals>>;
  let collaboration: Awaited<ReturnType<typeof api.collaboration>>;
  try {
    [summaries, departments, health, activity, goals, collaboration] = await Promise.all([
      api.employeeSummaries(),
      api.departments(),
      api.workforceHealth(),
      api.pulse(10),
      api.goals(),
      api.collaboration(),
    ]);
  } catch {
    return (
      <div className="space-y-6">
        <Header />
        <ApiDownNotice />
      </div>
    );
  }

  const deptById = new Map(departments.map((d) => [d.id, d]));
  const nameOf = new Map(summaries.map((s) => [s.employeeId, s.name]));
  const needle = q?.trim().toLowerCase();
  const visible = needle
    ? summaries.filter(
        (s) =>
          s.name.toLowerCase().includes(needle) ||
          s.title.toLowerCase().includes(needle) ||
          (deptById.get(s.departmentId)?.name.toLowerCase().includes(needle) ?? false),
      )
    : summaries;
  const nextDue =
    summaries
      .filter((s) => s.currentTask?.dueAt)
      .map((s) => ({ title: s.currentTask!.title, dueAt: s.currentTask!.dueAt! }))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0] ?? null;

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={12} />
      <Header
        controls={
          <WorkforceControls
            activeCount={health.activeEmployees}
            pausedCount={summaries.filter((s) => s.status === "paused").length}
          />
        }
      />

      <CompanyStatusBanner health={health} nextDue={nextDue} />

      <WorkforceHealthBar health={health} />

      <form method="get" className="max-w-sm">
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search employees, roles, departments…"
        />
      </form>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_364px]">
        <div className="space-y-5">
          {health.departmentsDetail.map((pulse) => {
            const dept = deptById.get(pulse.departmentId);
            const people = visible.filter((s) => s.departmentId === pulse.departmentId);
            if (needle && people.length === 0) return null;
            return (
              <DepartmentSection
                key={pulse.departmentId}
                pulse={pulse}
                description={dept?.description}
                leadName={
                  dept?.headEmployeeId ? nameOf.get(dept.headEmployeeId) : undefined
                }
              >
                {people.map((s) => (
                  <EmployeeLiveCard key={s.employeeId} summary={s} />
                ))}
              </DepartmentSection>
            );
          })}
        </div>

        <div className="space-y-6 lg:sticky lg:top-8 lg:self-start">
          <CompanyPulsePanel health={health} />
          <CollaborationPanel threads={collaboration} />
          <GoalsPanel goals={goals} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_364px]">
        <CompanyPulse items={activity} showAllLink />
        <div className="card self-start">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Structure</h3>
          <p className="text-sm text-muted">
            Reporting lines live on the{" "}
            <Link href="/org" className="text-accent-soft hover:underline">
              org chart →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function Header({ controls }: { controls?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">AI Workforce</h1>
        <p className="text-sm text-muted">
          The command center — live work, operational health, and what needs you.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {controls}
        <Link href="/employees/new" className="btn shrink-0">
          + Hire AI employee
        </Link>
      </div>
    </div>
  );
}
