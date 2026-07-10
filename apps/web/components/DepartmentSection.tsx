"use client";

import { useState } from "react";
import Link from "next/link";
import type { DepartmentPulse } from "@/lib/server-api";

const HEALTH_BADGE: Record<DepartmentPulse["health"], { label: string; className: string }> = {
  healthy: { label: "● Healthy", className: "border-success/40 text-success" },
  busy: { label: "◉ Busy", className: "border-warn/50 text-warn" },
  attention: { label: "▲ Needs attention", className: "border-danger/50 text-danger" },
};

function money(n: number): string {
  return n === 0 ? "$0" : `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
}

/**
 * An expandable department container: the header is a status line (health
 * badge, headcount, output today, open tasks, cost) that stays useful even
 * collapsed; expanding reveals the members' live cards plus a hire tile
 * pre-targeted at this department. All figures come from /v1/workforce/health.
 */
export function DepartmentSection({
  pulse,
  description,
  leadName,
  children,
}: {
  pulse: DepartmentPulse;
  description?: string;
  leadName?: string;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const badge = HEALTH_BADGE[pulse.health];

  return (
    <section
      id={`dept-${pulse.departmentId}`}
      className="scroll-mt-6 rounded-2xl border border-border/70 bg-surface/40"
    >
      <button
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="text-sm font-semibold">{pulse.name}</span>
        <span className={`pill ${badge.className}`}>{badge.label}</span>
        <span className="text-xs text-muted">
          {pulse.employees} employee{pulse.employees === 1 ? "" : "s"}
          {leadName ? ` · led by ${leadName}` : ""}
          {pulse.completedToday > 0 ? ` · ${pulse.completedToday} done today` : ""}
          {pulse.openTasks > 0 ? ` · ${pulse.openTasks} open` : ""}
          {pulse.costTodayUsd > 0 ? ` · ${money(pulse.costTodayUsd)} today` : ""}
        </span>
        <span className="ml-auto text-xs text-muted">{expanded ? "▾" : `▸ ${pulse.employees}`}</span>
        {description && expanded && (
          <span className="w-full text-xs text-muted/80">{description}</span>
        )}
      </button>

      {expanded && (
        <div className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2">
          {children}
          <Link
            href={`/employees/new?departmentId=${pulse.departmentId}`}
            className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted transition hover:border-accent hover:text-accent-soft"
          >
            + Hire into {pulse.name}
          </Link>
        </div>
      )}
    </section>
  );
}
