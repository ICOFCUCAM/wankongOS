import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { HireForm } from "@/components/HireForm";

export const dynamic = "force-dynamic";

export default async function HirePage() {
  let departments;
  let employees;
  try {
    [departments, employees] = await Promise.all([api.departments(), api.employees()]);
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
