import type { api } from "@/lib/server-api";

/** The company talking to itself: consultations and delegations, live. */
export function CollaborationPanel({
  threads,
}: {
  threads: Awaited<ReturnType<typeof api.collaboration>>;
}) {
  if (threads.length === 0) return null;
  return (
    <div className="card">
      <h2 className="mb-3 font-medium">Collaboration</h2>
      <ul className="space-y-2.5">
        {threads.slice(0, 5).map((t) => (
          <li key={t.id} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-medium text-text/90">
                {t.from} ↔ {t.to}
              </span>
              <span className="shrink-0 text-muted">{t.turns} turns</span>
            </div>
            {t.lastLine && (
              <p className="mt-0.5 truncate text-xs text-muted">“{t.lastLine}”</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
