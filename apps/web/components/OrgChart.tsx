"use client";

import { useState } from "react";
import Link from "next/link";
import type { OrgChartNode } from "@wankong/core";
import type { EmployeeSummary } from "@/lib/server-api";
import { activityStyle } from "@/lib/activity";
import { Avatar } from "./Avatar";

/**
 * The reporting structure as a living chart: every node carries its
 * employee's derived status dot and, while working, the task in flight —
 * so the hierarchy shows not just who reports to whom, but who is doing
 * what right now. Subtrees collapse for larger organizations, and nodes
 * link straight into the employee workspace.
 */
function Node({
  node,
  byId,
}: {
  node: OrgChartNode;
  byId: Map<string, EmployeeSummary>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showWork, setShowWork] = useState(false);
  const e = node.employee;
  const summary = byId.get(e.id);
  const style = summary ? activityStyle(summary.activity) : null;

  return (
    <li className="relative">
      <div className="flex items-center gap-1.5">
        <Link
          href={`/employees/${e.id}`}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 transition hover:border-accent"
          title={
            summary?.currentTask
              ? `${style?.label ?? ""}: ${summary.currentTask.title}`
              : style?.label
          }
        >
          <div className="relative shrink-0">
            <Avatar name={e.name} size={32} />
            {style && (
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-2 ${style.dot} ${style.live ? "live-dot" : ""}`}
              />
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium group-hover:text-accent-soft">
              {e.name}
            </div>
            <div className="truncate text-xs text-muted">
              {summary?.activity === "working" && summary.currentTask
                ? summary.currentTask.title
                : e.title}
            </div>
          </div>
          {summary && summary.waitingApprovals > 0 && (
            <span className="ml-auto shrink-0 rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">
              {summary.waitingApprovals}
            </span>
          )}
        </Link>
        {summary && summary.openTasks > 0 && (
          <button
            className="shrink-0 rounded-md px-1 py-0.5 font-mono text-[10px] text-muted transition hover:text-accent-soft"
            onClick={() => setShowWork((v) => !v)}
            title={`${summary.openTasks} open task(s) — click to ${showWork ? "hide" : "show"}`}
          >
            ☰{summary.openTasks}
          </button>
        )}
        {node.reports.length > 0 && (
          <button
            className="shrink-0 rounded-md px-1 py-0.5 text-xs text-muted transition hover:text-text"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand reports" : "Collapse reports"}
            title={
              collapsed
                ? `Show ${node.reports.length} report(s)`
                : `Hide ${node.reports.length} report(s)`
            }
          >
            {collapsed ? `▸ ${node.reports.length}` : "▾"}
          </button>
        )}
      </div>
      {showWork && summary && (
        <ul className="ml-11 mt-1.5 space-y-1 border-l border-border/60 pl-3">
          {summary.workingOn.map((title) => (
            <li key={title} className="flex items-center gap-1.5 text-xs text-muted">
              <span className="live-dot h-1 w-1 rounded-full bg-success" />
              <span className="truncate">{title}</span>
            </li>
          ))}
          {summary.openTasks > summary.workingOn.length && (
            <li className="text-[11px] text-muted/70">
              +{summary.openTasks - summary.workingOn.length} queued
            </li>
          )}
        </ul>
      )}
      {node.reports.length > 0 && !collapsed && (
        <ul className="ml-5 mt-2 space-y-2 border-l border-border pl-4">
          {node.reports.map((child) => (
            <Node key={child.employee.id} node={child} byId={byId} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrgChart({
  roots,
  summaries = [],
}: {
  roots: OrgChartNode[];
  summaries?: EmployeeSummary[];
}) {
  const byId = new Map(summaries.map((s) => [s.employeeId, s]));
  return (
    <div className="card">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-muted">
          CEO
        </div>
        <div className="text-sm font-medium">Reporting structure</div>
      </div>
      <ul className="ml-5 space-y-2 border-l border-border pl-4">
        {roots.map((root) => (
          <Node key={root.employee.id} node={root} byId={byId} />
        ))}
      </ul>
    </div>
  );
}
