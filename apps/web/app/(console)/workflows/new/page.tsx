import Link from "next/link";
import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";
import { WorkflowBuilder } from "@/components/WorkflowBuilder";

export const dynamic = "force-dynamic";

export default async function NewWorkflowPage() {
  let employees;
  try {
    employees = await api.employees();
  } catch {
    return <ApiDownNotice />;
  }
  return (
    <div className="space-y-6">
      <Link href="/workflows" className="text-sm text-muted hover:text-text">
        ← All workflows
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">New workflow</h1>
        <p className="text-sm text-muted">
          Design the graph the engine will run — no intermediate format, no export step.
        </p>
      </div>
      <WorkflowBuilder
        employees={employees
          .filter((e) => e.status !== "offboarded")
          .map((e) => ({ id: e.id, name: e.name, title: e.title }))}
      />
    </div>
  );
}
