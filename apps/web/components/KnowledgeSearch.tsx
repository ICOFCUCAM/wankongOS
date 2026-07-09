"use client";

import { useState } from "react";
import { PUBLIC_API_URL } from "@/lib/api";

interface Citation {
  documentId: string;
  title: string;
  chunkIndex: number;
  score: number;
  snippet: string;
}

/** Client-side semantic search over the organization's knowledge. */
export function KnowledgeSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Citation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/knowledge/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q, limit: 5 }),
      });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      setResults((await res.json()).data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="mb-3 font-medium">Search company knowledge</h2>
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="e.g. When does a refund need approval?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
        />
        <button className="btn" onClick={() => void search()} disabled={busy || !query.trim()}>
          {busy ? "…" : "Search"}
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      {results !== null && (
        <div className="mt-4 space-y-3">
          {results.length === 0 && <p className="text-sm text-muted">No matches.</p>}
          {results.map((r) => (
            <div
              key={`${r.documentId}:${r.chunkIndex}`}
              className="rounded-lg border border-border bg-surface-2 p-3"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">📄 {r.title}</span>
                <span className="pill text-[11px] text-muted">relevance {r.score.toFixed(2)}</span>
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{r.snippet}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
