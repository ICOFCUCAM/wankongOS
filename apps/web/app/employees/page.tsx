import type { Department } from "@wankong/core";
import { api, type EmployeeSummary } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { OrgChart } from "@/components/OrgChart";
import { EmployeeLiveCard } from "@/components/EmployeeLiveCard";
import { DepartmentStrip } from "@/components/DepartmentStrip";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  let summaries: EmployeeSummary[];
  let departments: Department[];
  let roots;
  try {
    [summaries, departments, roots] = await Promise.all([
      api.employeeSummaries(),
      api.departments(),
      api.orgChart(),
    ]);
  } catch {
    return (
      <div className="space-y-6">
        <Header count={0} working={0} />
        <ApiDownNotice />
      </div>
    );
  }

  const byDept = departments
    .map((d) => ({ dept: d, people: summaries.filter((s) => s.departmentId === d.id) }))
    .filter((g) => g.people.length > 0);
  const working = summaries.filter((s) => s.activity === "working").length;

  return (
    <div className="space-y-6">
      <Header count={summaries.length} working={working} />

      <DepartmentStrip departments={departments} summaries={summaries} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {byDept.map(({ dept, people }) => (
            <section key={dept.id} id={`dept-${dept.id}`} className="scroll-mt-6">
              <h2 className="mb-3 text-sm font-medium text-muted">{dept.name}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {people.map((s) => (
                  <EmployeeLiveCard key={s.employeeId} summary={s} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="lg:sticky lg:top-8 lg:self-start">
          <OrgChart roots={roots} summaries={summaries} />
        </div>
      </div>
    </div>
  );
}

function Header({ count, working }: { count: number; working: number }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold">AI Employees</h1>
        <p className="text-sm text-muted">
          {count} digital workers{working > 0 ? ` — ${working} working right now` : ""}.
        </p>
      </div>
    </div>
  );
}
