import Link from "next/link";
import type { Department, Employee } from "@wankong/core";
import { api } from "@/lib/api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { OrgChart } from "@/components/OrgChart";
import { Avatar } from "@/components/Avatar";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  let employees: Employee[];
  let departments: Department[];
  let roots;
  try {
    [employees, departments, roots] = await Promise.all([
      api.employees(),
      api.departments(),
      api.orgChart(),
    ]);
  } catch {
    return (
      <div className="space-y-6">
        <Header count={0} />
        <ApiDownNotice />
      </div>
    );
  }

  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const byDept = departments
    .map((d) => ({ dept: d, people: employees.filter((e) => e.departmentId === d.id) }))
    .filter((g) => g.people.length > 0);

  return (
    <div className="space-y-6">
      <Header count={employees.length} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {byDept.map(({ dept, people }) => (
            <section key={dept.id}>
              <h2 className="mb-3 text-sm font-medium text-muted">{dept.name}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {people.map((e) => (
                  <Link
                    key={e.id}
                    href={`/employees/${e.id}`}
                    className="group card flex items-start gap-3 transition hover:border-accent"
                  >
                    <Avatar name={e.name} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate font-medium group-hover:text-accent-soft">
                          {e.name}
                        </div>
                        <span
                          className={`pill ${
                            e.status === "active"
                              ? "border-success/40 text-success"
                              : "text-muted"
                          }`}
                        >
                          {e.status}
                        </span>
                      </div>
                      <div className="truncate text-sm text-muted">{e.title}</div>
                      <p className="mt-2 line-clamp-2 text-xs text-muted">{e.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {e.kpis.slice(0, 2).map((k) => (
                          <span key={k.key} className="pill text-muted">
                            {k.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="lg:sticky lg:top-8 lg:self-start">
          <OrgChart roots={roots} />
        </div>
      </div>
    </div>
  );
}

function Header({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold">AI Employees</h1>
        <p className="text-sm text-muted">{count} digital workers across your organization.</p>
      </div>
    </div>
  );
}
