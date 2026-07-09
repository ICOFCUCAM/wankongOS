"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PUBLIC_API_URL } from "@/lib/api";

/**
 * The org-wide kill switch: pause every active AI employee in one click
 * (workflow steps and chat refuse work until resumed).
 */
export function WorkforceControls({ activeCount, pausedCount }: { activeCount: number; pausedCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function post(action: "pause" | "resume") {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`${PUBLIC_API_URL}/v1/workforce/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      setConfirming(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (pausedCount > 0 && activeCount === 0) {
    return (
      <button className="btn px-3 py-1.5 text-xs" onClick={() => void post("resume")} disabled={busy}>
        {busy ? "…" : `Resume workforce (${pausedCount} paused)`}
      </button>
    );
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-xs text-warn">Pause all {activeCount} active employees?</span>
        <button
          className="btn bg-danger/80 px-3 py-1.5 text-xs hover:bg-danger"
          onClick={() => void post("pause")}
          disabled={busy}
        >
          {busy ? "…" : "Confirm"}
        </button>
        <button
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-text"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs text-danger transition hover:bg-danger/10"
      onClick={() => setConfirming(true)}
    >
      ⏻ Kill switch
    </button>
  );
}
