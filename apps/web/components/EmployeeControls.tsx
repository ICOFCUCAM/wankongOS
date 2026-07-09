"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PUBLIC_API_URL } from "@/lib/api";

/**
 * Lifecycle controls: pause/resume (kill switch) and probation activation.
 * Activation runs the employee's eval suite server-side and is rejected with
 * the failing report if it doesn't pass.
 */
export function EmployeeControls({ employeeId, status }: { employeeId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function post(action: "pause" | "resume" | "activate") {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/employees/${employeeId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = await res.json();
      if (res.status === 422) {
        setNotice(`Activation blocked: fails eval suite (${body.report.passedTasks}/${body.report.totalTasks} tasks pass).`);
      } else if (!res.ok) {
        setNotice(body.error ?? `Request failed (${res.status})`);
      } else {
        router.refresh();
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {status === "active" && (
        <button
          className="btn bg-danger/80 px-3 py-1.5 text-xs hover:bg-danger"
          onClick={() => void post("pause")}
          disabled={busy}
        >
          {busy ? "…" : "Pause"}
        </button>
      )}
      {status === "paused" && (
        <button className="btn px-3 py-1.5 text-xs" onClick={() => void post("resume")} disabled={busy}>
          {busy ? "…" : "Resume"}
        </button>
      )}
      {status === "training" && (
        <button className="btn px-3 py-1.5 text-xs" onClick={() => void post("activate")} disabled={busy}>
          {busy ? "Running evals…" : "Activate (runs evals)"}
        </button>
      )}
      {notice && <span className="text-xs text-warn">{notice}</span>}
    </div>
  );
}
