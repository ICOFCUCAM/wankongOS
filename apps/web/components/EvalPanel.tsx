"use client";

import { useState } from "react";
import type { EvalReport, EvalSuite } from "@wankong/core";
import { PUBLIC_API_URL } from "@/lib/api";

/**
 * AI QA panel: shows the employee's golden-task suite, runs it on demand, and
 * displays the latest report. The same suite gates config edits server-side.
 */
export function EvalPanel({
  employeeId,
  suite,
  initialReports,
}: {
  employeeId: string;
  suite: EvalSuite | null;
  initialReports: EvalReport[];
}) {
  const [reports, setReports] = useState(initialReports);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!suite) {
    return (
      <div className="card">
        <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">AI QA</h3>
        <p className="text-sm text-muted">No eval suite defined for this employee yet.</p>
      </div>
    );
  }

  const latest = reports[0];

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/employees/${employeeId}/evals/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(`Eval run failed (${res.status})`);
      const report = (await res.json()) as EvalReport;
      setReports((r) => [report, ...r].slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eval run failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs uppercase tracking-wide text-muted">AI QA — {suite.name}</h3>
        <button className="btn px-3 py-1.5 text-xs" onClick={() => void run()} disabled={busy}>
          {busy ? "Running…" : "Run evals"}
        </button>
      </div>

      <p className="mb-3 text-xs text-muted">
        {suite.tasks.length} golden task(s). Config changes that fail this suite are blocked
        automatically.
      </p>

      {error && <p className="mb-2 text-xs text-danger">{error}</p>}

      {latest ? (
        <div className="space-y-2">
          <div
            className={`pill ${latest.pass ? "border-success/50 text-success" : "border-danger/50 text-danger"}`}
          >
            {latest.pass ? "PASS" : "FAIL"} · {latest.passedTasks}/{latest.totalTasks} tasks ·{" "}
            {latest.trigger === "gate" ? "regression gate" : "manual run"}
          </div>
          <ul className="space-y-1.5">
            {latest.results.map((r) => (
              <li key={r.taskId} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs">{r.taskName}</span>
                  <span className={`text-[11px] ${r.pass ? "text-success" : "text-danger"}`}>
                    {r.pass ? "✓ pass" : "✗ fail"}
                  </span>
                </div>
                {!r.pass && (
                  <div className="mt-1 text-[11px] text-muted">
                    {r.checks
                      .filter((ch) => !ch.pass)
                      .map((ch, i) => (
                        <div key={i}>· {ch.detail}</div>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted">Not run yet.</p>
      )}
    </div>
  );
}
