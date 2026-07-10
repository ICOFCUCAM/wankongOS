import type { api } from "@/lib/server-api";

const KIND_GLYPH: Record<string, string> = {
  task_done: "✓",
  task_step: "↻",
  approval: "✋",
  delegation: "🤝",
  conversation: "💬",
  asset: "📄",
  lifecycle: "•",
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.floor((today.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * The memory timeline (ADR-0027): what this employee actually did, grouped
 * by day, every line traceable to a record. Ask them "why?" in chat — the
 * same evidence grounds their answer.
 */
export function WorkTimeline({
  items,
}: {
  items: Awaited<ReturnType<typeof api.employeeTimeline>>;
}) {
  if (items.length === 0) {
    return (
      <div className="card">
        <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Work timeline</h3>
        <p className="text-sm text-muted">Their record starts with their first task.</p>
      </div>
    );
  }
  const groups: { day: string; items: typeof items }[] = [];
  for (const item of items) {
    const day = dayLabel(item.at);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return (
    <div className="card">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wide text-muted">Work timeline</h3>
        <span className="text-[11px] text-muted">every line traces to a record</span>
      </div>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.day}>
            <div className="mb-1.5 text-xs font-semibold text-accent-soft">{g.day}</div>
            <ul className="space-y-1.5 border-l border-border pl-3">
              {g.items.map((item, i) => (
                <li key={`${item.at}-${i}`} className="flex items-baseline gap-2 text-sm">
                  <span className="shrink-0 font-mono text-[10px] text-muted">
                    {new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="shrink-0">{KIND_GLYPH[item.kind] ?? "•"}</span>
                  <span className="min-w-0 flex-1 text-text/90">{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
