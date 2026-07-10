import Link from "next/link";
import { notFound } from "next/navigation";
import { api, ApiError } from "@/lib/server-api";
import { WorkflowBuilder } from "@/components/WorkflowBuilder";

export const dynamic = "force-dynamic";

export default async function EditWorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let workflow;
  let employees;
  try {
    [{ workflow }, employees] = await Promise.all([api.workflow(id), api.employees()]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  return (
    <div className="space-y-6">
      <Link href={`/workflows/${id}`} className="text-sm text-muted hover:text-text">
        ← {workflow.name}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Edit workflow</h1>
        <p className="text-sm text-muted">
          Changes replace the definition on save — paused runs resume against the updated
          definition, so keep node ids stable while runs are in flight.
        </p>
      </div>
      <WorkflowBuilder
        initial={workflow}
        employees={employees
          .filter((e) => e.status !== "offboarded")
          .map((e) => ({ id: e.id, name: e.name, title: e.title }))}
      />
    </div>
  );
}
