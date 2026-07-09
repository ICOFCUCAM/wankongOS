import Link from "next/link";
import { notFound } from "next/navigation";
import type { Workflow, WorkflowRun } from "@/lib/api";
import { api, ApiError } from "@/lib/api";
import { RunPanel } from "@/components/RunPanel";

export const dynamic = "force-dynamic";

const NODE_ICON: Record<string, string> = {
  start: "●",
  employee: "◈",
  decision: "◆",
  approval: "⚑",
  notification: "✉",
  integration: "⧉",
  parallel: "⋔",
  end: "◼",
};

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let data: { workflow: Workflow; runs: WorkflowRun[] };
  try {
    data = await api.workflow(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const { workflow } = data;

  return (
    <div className="space-y-6">
      <Link href="/workflows" className="text-sm text-muted hover:text-text">
        ← All workflows
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">{workflow.name}</h1>
        <p className="text-sm text-muted">{workflow.description}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        <div className="card">
          <h3 className="mb-3 text-sm font-medium">Definition</h3>
          <ol className="space-y-2">
            {workflow.nodes.map((n) => (
              <li key={n.id} className="flex items-center gap-2 text-sm">
                <span className="w-4 text-center text-accent-soft">{NODE_ICON[n.type] ?? "•"}</span>
                <span className="font-mono text-xs text-muted">{n.type}</span>
                <span>{"name" in n && n.name ? n.name : n.id}</span>
              </li>
            ))}
          </ol>
        </div>

        <RunPanel workflowId={workflow.id} />
      </div>
    </div>
  );
}
