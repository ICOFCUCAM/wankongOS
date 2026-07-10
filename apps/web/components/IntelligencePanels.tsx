"use client";

import { useState } from "react";
import Link from "next/link";
import { PUBLIC_API_URL } from "@/lib/api";

/**
 * Ask panels for the BI department and the Strategy Office. Both endpoints
 * are honestly gated — a 422 means the department isn't staffed, and the
 * panel says so with a pointer to the marketplace instead of pretending.
 */
function AskPanel({
  title,
  subtitle,
  placeholder,
  path,
  field,
  answerKey,
  bylineKey,
}: {
  title: string;
  subtitle: string;
  placeholder: string;
  path: string;
  field: string;
  answerKey: string;
  bylineKey: string;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [byline, setByline] = useState<string | null>(null);
  const [gateMsg, setGateMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    setGateMsg(null);
    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: input.trim() }),
      });
      const data = await res.json();
      if (res.status === 422) {
        setGateMsg(data.error);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setAnswer(data[answerKey]);
      setByline(data[bylineKey]?.name ?? null);
    } catch {
      setError("Could not reach the API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-medium">{title}</h2>
        <p className="text-xs text-muted">{subtitle}</p>
      </div>
      <textarea
        className="input min-h-16"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
      />
      <button type="button" onClick={submit} disabled={busy || !input.trim()} className="btn disabled:opacity-50">
        {busy ? "Working from the records…" : "Ask"}
      </button>
      {gateMsg && (
        <p className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">
          {gateMsg}{" "}
          <Link href="/marketplace" className="underline">
            Open marketplace →
          </Link>
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      {answer && (
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          {byline && <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">{byline} answers</div>}
          <p className="whitespace-pre-wrap text-sm">{answer}</p>
          <p className="mt-2 text-[11px] text-muted">
            Filed as an asset with the full evidence pack — searchable in company memory.
          </p>
        </div>
      )}
    </div>
  );
}

export function IntelligencePanels() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <AskPanel
        title="Ask Business Intelligence"
        subtitle="Answers cite the evidence pack below; missing data is named, never guessed."
        placeholder="Why did task throughput drop in Sales?"
        path="/intelligence/ask"
        field="question"
        answerKey="answer"
        bylineKey="analyst"
      />
      <AskPanel
        title="Ask the Strategy Office"
        subtitle="Plans are disclosed scenario math over recorded numbers — never forecasts."
        placeholder="How do we reach $10M ARR?"
        path="/intelligence/plan"
        field="goal"
        answerKey="plan"
        bylineKey="strategist"
      />
    </div>
  );
}
