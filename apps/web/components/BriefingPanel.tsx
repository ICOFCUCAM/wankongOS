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
    <div className="card border-accent/30">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-medium">While you were away</h2>
        <span className="font-mono text-xs text-muted">
          AI spend ${briefing.estCostUsd.toFixed(briefing.estCostUsd < 0.1 ? 4 : 2)}
        </span>
      </div>
      <p className="mb-3 text-sm text-muted">{briefing.headline}</p>
      <ul className="space-y-1.5">
        {briefing.items.slice(0, 6).map((item, i) => (
          <li key={`${item.at}-${i}`} className="flex items-baseline gap-2 text-sm">
            <span className="shrink-0 font-mono text-xs text-muted">
              {new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
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
