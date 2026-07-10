import type { Goal } from "@wankong/core";

const STATUS_BAR: Record<Goal["status"], string> = {
  on_track: "bg-success",
  achieved: "bg-success",
  at_risk: "bg-warn",
  off_track: "bg-danger",
};

/** Business goals with live progress — the "why" behind the workforce's work. */
export function GoalsPanel({ goals }: { goals: Goal[] }) {
  if (goals.length === 0) return null;
  return (
    <div className="card">
      <h2 className="mb-3 font-medium">Business goals</h2>
      <div className="space-y-3">
        {goals.map((g) => (
          <div key={g.id}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-text/90">{g.title}</span>
              <span className="shrink-0 font-mono text-muted">
                {Math.round(g.progress * 100)}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`bar-fill h-full rounded-full ${STATUS_BAR[g.status]}`}
                style={{ width: `${Math.round(g.progress * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
