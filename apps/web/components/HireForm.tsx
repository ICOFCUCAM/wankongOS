"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PUBLIC_API_URL } from "@/lib/api";

interface Option {
  id: string;
  label: string;
}

/**
 * The hire flow (Problem 11): filling a role, not filling out a database
 * row. The form asks business questions — department, role, what they'll
 * own, who they report to, how they should operate, spending limit — and
 * composes the system prompt from those answers. New hires start on
 * probation ("training") and must pass evals to activate.
 */
interface ToolOption {
  id: string;
  description: string;
  requires: string | null;
}

export function HireForm({
  departments,
  managers,
  tools = [],
  initialDepartmentId,
}: {
  departments: Option[];
  managers: Option[];
  tools?: ToolOption[];
  initialDepartmentId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState(
    initialDepartmentId && departments.some((d) => d.id === initialDepartmentId)
      ? initialDepartmentId
      : (departments[0]?.id ?? ""),
  );
  const [responsibilities, setResponsibilities] = useState("");
  const [managerId, setManagerId] = useState("");
  const [communicationStyle, setCommunicationStyle] = useState("professional");
  const [decisionSpeed, setDecisionSpeed] = useState("balanced");
  const [autonomy, setAutonomy] = useState("medium");
  const [dailyTokenBudget, setDailyTokenBudget] = useState("");
  const [toolIds, setToolIds] = useState<string[]>([]);

  function toggleTool(id: string) {
    setToolIds((current) =>
      current.includes(id) ? current.filter((t) => t !== id) : [...current, id],
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const systemPrompt = [
      `You are ${name.trim()}, ${title.trim()} at this company.`,
      `Your responsibilities: ${responsibilities.trim()}`,
      "Stay within your role. Request approval for anything outside your granted authority.",
    ].join("\n");

    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/employees`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          title: title.trim(),
          departmentId,
          description: responsibilities.trim(),
          systemPrompt,
          ...(managerId ? { managerId } : {}),
          ...(dailyTokenBudget ? { dailyTokenBudget: Number(dailyTokenBudget) } : {}),
          toolIds,
          personality: { communicationStyle, decisionSpeed, autonomy },
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Hire failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.push(`/employees/${body.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hire failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Riley"
            required
          />
        </Field>
        <Field label="Role title">
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Customer Success Manager"
            required
          />
        </Field>
        <Field label="Department">
          <select
            className="input"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reports to">
          <select
            className="input"
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
          >
            <option value="">No manager (reports to you)</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Responsibilities — what will they own?">
        <textarea
          className="input min-h-24"
          value={responsibilities}
          onChange={(e) => setResponsibilities(e.target.value)}
          placeholder="Handle inbound support tickets, draft responses, escalate refunds over $500…"
          required
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Communication style">
          <select
            className="input"
            value={communicationStyle}
            onChange={(e) => setCommunicationStyle(e.target.value)}
          >
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="concise">Concise</option>
            <option value="detailed">Detailed</option>
          </select>
        </Field>
        <Field label="Decision speed">
          <select
            className="input"
            value={decisionSpeed}
            onChange={(e) => setDecisionSpeed(e.target.value)}
          >
            <option value="deliberate">Deliberate</option>
            <option value="balanced">Balanced</option>
            <option value="fast">Fast</option>
          </select>
        </Field>
        <Field label="Autonomy">
          <select
            className="input"
            value={autonomy}
            onChange={(e) => setAutonomy(e.target.value)}
          >
            <option value="low">Low — ask often</option>
            <option value="medium">Medium</option>
            <option value="high">High — act freely</option>
          </select>
        </Field>
      </div>

      {tools.length > 0 && (
        <Field label="Tools — what can they use?">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {tools.map((t) => (
              <label
                key={t.id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition ${
                  toolIds.includes(t.id)
                    ? "border-accent bg-accent/5"
                    : "border-border hover:border-accent/50"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={toolIds.includes(t.id)}
                  onChange={() => toggleTool(t.id)}
                />
                <span>
                  <span className="block font-mono text-xs">{t.id}</span>
                  <span className="block text-xs text-muted">{t.description}</span>
                  {t.requires && (
                    <span className="block text-[11px] text-muted/70">
                      needs permission: {t.requires}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </Field>
      )}

      <Field label="Daily token budget (optional)">
        <input
          className="input"
          type="number"
          min={1}
          value={dailyTokenBudget}
          onChange={(e) => setDailyTokenBudget(e.target.value)}
          placeholder="e.g. 200000 — hard spend cap per day"
        />
      </Field>

      <div className="rounded-lg border border-info/30 bg-info/5 px-4 py-3 text-sm text-muted">
        New hires start on <span className="text-info">probation</span>: they can be interviewed
        and evaluated, but only take real work after passing their eval suite and being activated.
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Hiring…" : "Hire employee"}
        </button>
        <button
          type="button"
          className="text-sm text-muted hover:text-text"
          onClick={() => router.back()}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}
