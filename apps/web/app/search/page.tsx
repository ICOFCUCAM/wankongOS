import Link from "next/link";
import { api } from "@/lib/server-api";
import { ApiDownNotice } from "@/components/ApiDownNotice";

export const dynamic = "force-dynamic";

const GROUP_META: Record<string, { label: string; glyph: string }> = {
  employees: { label: "People", glyph: "👤" },
  tasks: { label: "Tasks", glyph: "☰" },
  assets: { label: "Assets & documents", glyph: "📄" },
  conversations: { label: "Conversations", glyph: "💬" },
  approvals: { label: "Approvals", glyph: "✋" },
  knowledge: { label: "Knowledge", glyph: "◱" },
  audit: { label: "Audit trail", glyph: "⚖" },
};

/** Company memory: one query across everything the organization recorded. */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  let results = null;
  if (q && q.trim().length >= 2) {
    try {
      results = await api.search(q.trim());
    } catch {
      return <ApiDownNotice />;
    }
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Company Memory</h1>
        <p className="text-sm text-muted">
          Search everything the organization has recorded — people, work, documents,
          conversations, decisions, and knowledge.
        </p>
      </div>
      <form method="get">
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Board meeting, invoice, NDA, Kubernetes…"
          autoFocus
        />
      </form>
      {results && (
        <div className="space-y-5">
          <p className="text-xs text-muted">
            {results.total} result{results.total === 1 ? "" : "s"} for “{results.query}”
          </p>
          {Object.entries(results.groups)
            .filter(([, hits]) => hits.length > 0)
            .map(([key, hits]) => (
              <div key={key} className="card">
                <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">
                  {GROUP_META[key]?.glyph} {GROUP_META[key]?.label ?? key}
                </h2>
                <ul className="space-y-2">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <Link href={h.link} className="group block">
                        <span className="text-sm font-medium group-hover:text-accent-soft">
                          {h.title}
                        </span>
                        {h.snippet && (
                          <span className="block truncate text-xs text-muted">{h.snippet}</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {results.total === 0 && (
            <p className="text-sm text-muted">Nothing recorded matches — yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
