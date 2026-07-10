import Link from "next/link";
import type { PulseItem } from "@/lib/server-api";

const KIND_DOT: Record<PulseItem["kind"], string> = {
  task: "bg-success",
  approval: "bg-warn",
  audit: "bg-accent",
};

function relativeTime(iso: string, now: number): string {
  const delta = Math.max(0, now - Date.parse(iso));
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Company pulse (Problem 10): the live feed of what the workforce actually
 * did — every line comes from /v1/pulse, which reads stored tasks,
 * approvals, and the audit trail. No synthetic activity.
 */
export function CompanyPulse({
  items,
  showAllLink = false,
}: {
  items: PulseItem[];
  showAllLink?: boolean;
}) {
  const now = Date.now();
  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2">
        <span className="live-dot h-2 w-2 rounded-full bg-accent" />
        <h2 className="font-medium">Company pulse</h2>
        {showAllLink && (
          <Link href="/pulse" className="ml-auto text-xs text-accent-soft hover:underline">
            View all →
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted">Quiet so far — activity shows up here as it happens.</p>
      ) : (
        <ul className="pulse-list space-y-2.5">
          {items.map((item, i) => {
            const line = (
              <span className="flex items-baseline gap-2.5">
                <span
                  className={`mt-1 h-1.5 w-1.5 shrink-0 self-center rounded-full ${KIND_DOT[item.kind]}`}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-text/90">{item.text}</span>
                <span className="shrink-0 text-xs text-muted">{relativeTime(item.at, now)}</span>
              </span>
            );
            return (
              <li key={`${item.at}-${i}`}>
                {item.employeeId ? (
                  <Link
                    href={`/employees/${item.employeeId}`}
                    className="block rounded-md transition hover:bg-surface-2"
                  >
                    {line}
                  </Link>
                ) : (
                  line
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
