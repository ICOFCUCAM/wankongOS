import Link from "next/link";
import { notFound } from "next/navigation";
import type { Workflow, WorkflowRun } from "@/lib/api";
import { api, ApiError } from "@/lib/server-api";
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
          <ol className="space-y-0">
            {workflow.nodes.map((n, i) => (
              <li key={n.id}>
                <div
                  className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm ${
                    n.type === "approval"
                      ? "border-approval/50 bg-approval/5"
                      : n.type === "decision"
                        ? "border-info/40 bg-info/5"
                        : "border-border bg-surface-2"
                  }`}
                >
                  <span className="w-4 text-center text-accent-soft">{NODE_ICON[n.type] ?? "•"}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {"name" in n && n.name ? n.name : n.id}
                  </span>
                  <span className="pill font-mono text-[10px] text-muted">{n.type}</span>
                </div>
                {i < workflow.nodes.length - 1 && (
                  <div className="my-0.5 ml-6 h-4 w-px border-l border-dashed border-border" />
                )}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted">
            Approval nodes pause the run for a human; decision nodes branch. A drag-and-drop
            builder is on the roadmap — this graph reads the same definition it will edit.
          </p>
        </div>

        <RunPanel workflowId={workflow.id} />
      </div>
    </div>
  );
}
