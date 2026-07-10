"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PUBLIC_API_URL } from "@/lib/api";

interface Update {
  department: string;
  employeeId: string;
  employeeName: string;
  update: string;
}

export function StartMeeting() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [updates, setUpdates] = useState<Update[] | null>(null);
  const [absent, setAbsent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/meetings/executive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? `Failed (${res.status})`);
      else {
        setUpdates(body.updates);
        setAbsent(body.absent ?? []);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <button className="btn" onClick={() => void start()} disabled={busy}>
        {busy ? "Departments reporting…" : updates ? "Hold another meeting" : "▶ Start executive meeting"}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
      {updates && (
        <div className="space-y-3">
          {updates.map((u) => (
            <div key={u.department} className="card !p-4">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="font-medium">{u.department}</span>
                <span className="text-xs text-muted">{u.employeeName}</span>
              </div>
              <p className="text-sm text-text/90">{u.update}</p>
            </div>
          ))}
          {absent.length > 0 && (
            <p className="text-xs text-muted">Absent (no active employees): {absent.join(", ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
