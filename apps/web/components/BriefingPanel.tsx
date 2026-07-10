import Link from "next/link";
import type { Briefing } from "@/lib/server-api";

/**
 * "What happened while you were away" (Level 12): the CEO's first read of
 * the day, straight from /v1/briefing. Hidden when the window is empty —
 * a quiet night should look quiet.
 */
export function BriefingPanel({ briefing }: { briefing: Briefing }) {
  if (briefing.completed === 0 && briefing.newHires === 0 && briefing.items.length === 0) {
    return null;
  }
  return (
    <div className="card border-l-2 border-l-accent">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">While you were away</h2>
        <span className="font-mono text-xs text-muted">
          AI spend ${briefing.estCostUsd.toFixed(briefing.estCostUsd < 0.1 ? 4 : 2)}
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <span className="pill border-success/40 text-success">✓ {briefing.completed} completed</span>
        {briefing.newHires > 0 && (
          <span className="pill border-accent/40 text-accent-soft">+ {briefing.newHires} hired</span>
        )}
        <span className={`pill ${briefing.blocked > 0 ? "border-danger/50 text-danger" : "text-muted"}`}>
          {briefing.blocked > 0 ? `⚠ ${briefing.blocked} blocked` : "no blockers"}
        </span>
        <span className={`pill ${briefing.approvalsPending > 0 ? "border-approval/50 text-approval" : "text-muted"}`}>
          {briefing.approvalsPending > 0
            ? `${briefing.approvalsPending} approval${briefing.approvalsPending === 1 ? "" : "s"} pending`
            : "no approvals pending"}
        </span>
      </div>
      <ul className="space-y-1.5">
        {briefing.items.slice(0, 6).map((item, i) => (
          <li key={`${item.at}-${i}`} className="flex items-baseline gap-2 text-sm">
            <span className="shrink-0 font-mono text-xs text-muted">
              {new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="shrink-0">{item.text.includes("blocked") ? "⚠" : "✓"}</span>
            {item.employeeId ? (
              <Link
                href={`/employees/${item.employeeId}`}
                className="truncate text-text/90 hover:text-accent-soft"
              >
                {item.text}
              </Link>
            ) : (
              <span className="truncate text-text/90">{item.text}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
