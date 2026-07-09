"use client";

import { useState } from "react";
import type { Report } from "@wankong/core";
import { PUBLIC_API_URL } from "@/lib/api";

const RATING: Record<number, { label: string; cls: string }> = {
  2: { label: "Exceeding expectations", cls: "border-success/50 text-success" },
  1: { label: "Meeting expectations", cls: "border-accent/50 text-accent-soft" },
  0: { label: "Needs attention", cls: "border-warn/50 text-warn" },
};

/** KPI-backed performance reviews, generated from the employee's real activity. */
export function ReviewPanel({
  employeeId,
  initialReviews,
}: {
  employeeId: string;
  initialReviews: Report[];
}) {
  const [reviews, setReviews] = useState(initialReviews);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = reviews[0];

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/employees/${employeeId}/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(`Review failed (${res.status})`);
      const review = (await res.json()) as Report;
      setReviews((r) => [review, ...r]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs uppercase tracking-wide text-muted">Performance review</h3>
        <button className="btn px-3 py-1.5 text-xs" onClick={() => void generate()} disabled={busy}>
          {busy ? "Compiling…" : "Generate review"}
        </button>
      </div>

      {error && <p className="mb-2 text-xs text-danger">{error}</p>}

      {latest ? (
        <div className="space-y-3">
          <span className={`pill ${RATING[latest.metrics.rating ?? 1]?.cls ?? "text-muted"}`}>
            {RATING[latest.metrics.rating ?? 1]?.label ?? "Unrated"}
          </span>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">
            {latest.narrative}
          </p>
          <div className="text-[11px] text-muted">
            Generated {new Date(latest.createdAt).toLocaleString()} · every figure derives from
            stored records
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">
          No reviews yet — generate one to see quality, delivery, and goal metrics.
        </p>
      )}
    </div>
  );
}
