import Link from "next/link";
import type { Workflow, WorkflowRun } from "@/lib/api";
import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";

export const dynamic = "force-dynamic";

const RUN_STATUS: Record<string, string> = {
  running: "border-accent/40 text-accent-soft",
  paused: "border-warn/50 text-warn",
  completed: "border-success/50 text-success",
  failed: "border-danger/50 text-danger",
};

export default async function WorkflowsPage() {
  let workflows: Workflow[];
  let runs: WorkflowRun[];
  try {
    [workflows, runs] = await Promise.all([api.workflows(), api.runs()]);
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {workflows.map((w) => {
          const wfRuns = runs.filter((r) => r.workflowId === w.id);
          return (
            <Link
              key={w.id}
              href={`/workflows/${w.id}`}
              className="group card transition hover:border-accent"
            >
              <div className="flex items-center justify-between">
                <div className="font-medium group-hover:text-accent-soft">{w.name}</div>
                <span className="pill text-muted">{w.nodes.length} nodes</span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{w.description}</p>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                <span className="pill text-muted">trigger: {w.trigger.kind}</span>
                <span>{wfRuns.length} runs</span>
              </div>
            </Link>
          );
        })}
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">Recent runs</h2>
        {runs.length === 0 ? (
          <div className="card text-sm text-muted">No runs yet — open a workflow to trigger one.</div>
        ) : (
          <div className="card divide-y divide-border p-0">
            {runs.slice(0, 12).map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`pill ${RUN_STATUS[r.status] ?? "text-muted"}`}>{r.status}</span>
                  <span className="font-mono text-xs text-muted">{r.id.slice(0, 16)}…</span>
                </div>
                <span className="text-xs text-muted">{r.steps.length} steps</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Header() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Workflows</h1>
        <p className="text-sm text-muted">
          Automations that route work through AI employees, approvals, and integrations.
        </p>
      </div>
      <Link href="/workflows/new" className="btn shrink-0">
        + New workflow
      </Link>
    </div>
  );
}
