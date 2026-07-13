import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { HireForm } from "@/components/HireForm";

export const dynamic = "force-dynamic";

export default async function HirePage({
  searchParams,
}: {
  searchParams: Promise<{ departmentId?: string }>;
}) {
  const { departmentId } = await searchParams;
  let departments;
  let employees;
  let tools;
  let kbs;
  try {
    [departments, employees, tools, kbs] = await Promise.all([
      api.departments(),
      api.employees(),
      api.tools(),
      api.knowledgeBases(),
    ]);
  } catch {
    return (
      <div className="space-y-6">
        <Header />
        <ApiDownNotice />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />
      <HireForm
        departments={departments.map((d) => ({ id: d.id, label: d.name }))}
        managers={employees.map((e) => ({ id: e.id, label: `${e.name} — ${e.title}` }))}
        tools={tools}
        knowledgeBases={kbs.map((kb) => ({ id: kb.id, label: `${kb.name} (${kb.documentCount} docs)` }))}
        initialDepartmentId={departmentId}
      />
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Hire an AI employee</h1>
      <p className="text-sm text-muted">
        Define the role like you would for a human hire — the OS handles the rest.
      </p>
    </div>
  );
}
