"use client";

import { useState } from "react";
import { PUBLIC_API_URL } from "@/lib/api";

interface Step {
  id: string;
  nodeId: string;
  type: string;
  status: string;
  note?: string;
  error?: string;
}
interface Run {
  id: string;
  status: string;
  pendingApprovalId?: string;
  currentNodeId?: string;
  context: Record<string, unknown>;
  steps: Step[];
  error?: string;
}

const STATUS_STYLE: Record<string, string> = {
  running: "border-accent/40 text-accent-soft",
  paused: "border-warn/50 text-warn",
  completed: "border-success/50 text-success",
  failed: "border-danger/50 text-danger",
  cancelled: "text-muted",
  succeeded: "border-success/50 text-success",
  skipped: "text-muted",
};

export function RunPanel({ workflowId }: { workflowId: string }) {
  const [company, setCompany] = useState("BigCo");
  const [name, setName] = useState("Dana Lee");
  const [score, setScore] = useState(85);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/workflows/${workflowId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { lead: { name, company, score: Number(score) } } }),
      });
      if (!res.ok) throw new Error(`Run failed (${res.status})`);
      setRun(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start run");
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approved" | "rejected") {
    if (!run?.pendingApprovalId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${PUBLIC_API_URL}/v1/approvals/${run.pendingApprovalId}/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      if (!res.ok) throw new Error(`Decision failed (${res.status})`);
      const refreshed = await fetch(`${PUBLIC_API_URL}/v1/workflows/runs/${run.id}`);
      setRun(await refreshed.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit decision");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="mb-3 text-sm font-medium">Trigger a run</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs text-muted">
            Lead name
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="text-xs text-muted">
            Company
            <input
              className="input mt-1"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted">
            Lead score
            <input
              className="input mt-1"
              type="number"
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
            />
          </label>
        </div>
        <button className="btn mt-4" onClick={() => void start()} disabled={busy}>
          {busy ? "Running…" : "Run workflow"}
        </button>
        {error && <div className="mt-2 text-xs text-danger">{error}</div>}
      </div>

      {run && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">Run {run.id.slice(0, 12)}…</h3>
            <span className={`pill ${STATUS_STYLE[run.status] ?? "text-muted"}`}>{run.status}</span>
          </div>

          <ol className="relative space-y-3 border-l border-border pl-5">
            {run.steps.map((s) => (
              <li key={s.id} className="relative">
                <span
                  className="absolute -left-[23px] top-1 h-2.5 w-2.5 rounded-full border-2 border-bg"
                  style={{
                    background:
                      s.status === "failed"
                        ? "#f2597f"
                        : s.status === "paused"
                          ? "#f5b64b"
                          : "#33c481",
                  }}
                />
                <div className="flex items-center gap-2">
                  <span className="text-sm">{s.nodeId}</span>
                  <span className="pill font-mono text-[10px] text-muted">{s.type}</span>
                  <span className={`pill ${STATUS_STYLE[s.status] ?? "text-muted"}`}>
                    {s.status}
                  </span>
                </div>
                {s.note && <div className="text-xs text-muted">{s.note}</div>}
                {s.error && <div className="text-xs text-danger">{s.error}</div>}
              </li>
            ))}
          </ol>

          {run.status === "paused" && (
            <div className="mt-4 rounded-lg border border-warn/40 bg-warn/5 p-3">
              <div className="mb-2 text-sm text-warn">Human approval required</div>
              <div className="flex gap-2">
                <button
                  className="btn bg-success hover:bg-success/80"
                  onClick={() => void decide("approved")}
                  disabled={busy}
                >
                  Approve
                </button>
                <button
                  className="btn bg-surface-2 text-text hover:bg-border"
                  onClick={() => void decide("rejected")}
                  disabled={busy}
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          {typeof run.context.draft === "string" && (
            <div className="mt-4">
              <div className="mb-1 text-xs uppercase tracking-wide text-muted">Drafted outreach</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 text-xs">
                {run.context.draft as string}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
