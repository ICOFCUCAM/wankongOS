"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PUBLIC_API_URL } from "@/lib/api";

interface Option {
  id: string;
  label: string;
}

interface ToolOption {
  id: string;
  description: string;
  requires: string | null;
}

/** Authority choices map to REAL permissions — no cosmetic switches. */
const AUTHORITY: { key: string; label: string; permissions: string[] }[] = [
  { key: "tasks", label: "Can create tasks", permissions: ["task:create"] },
  { key: "approve", label: "Can approve requests", permissions: ["task:approve"] },
  { key: "knowledge", label: "Can read company knowledge", permissions: ["knowledge:read"] },
  { key: "publish", label: "Can publish to knowledge base", permissions: ["knowledge:write"] },
  { key: "workflows", label: "Can run workflows", permissions: ["workflow:run"] },
  { key: "hire", label: "Can hire employees", permissions: ["employee:create"] },
];

const BASE_PERMISSIONS = ["employee:read", "employee:chat", "task:read", "org:read"];

const STEPS = ["Role", "Responsibilities", "Knowledge & tools", "Authority", "Operating style"];

/**
 * The hiring center (Level 11): onboarding a team member, not filling a
 * database row. Five steps — role, what they own, what they know and can
 * use, what they're authorized to do (mapped to real permissions), and how
 * they operate — ending in a welcome screen. New hires start on probation.
 */
export function HireForm({
  departments,
  managers,
  tools = [],
  knowledgeBases = [],
  initialDepartmentId,
}: {
  departments: Option[];
  managers: Option[];
  tools?: ToolOption[];
  knowledgeBases?: Option[];
  initialDepartmentId?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hired, setHired] = useState<{ id: string; name: string } | null>(null);

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState(
    initialDepartmentId && departments.some((d) => d.id === initialDepartmentId)
      ? initialDepartmentId
      : (departments[0]?.id ?? ""),
  );
  const [managerId, setManagerId] = useState("");
  const [responsibilities, setResponsibilities] = useState<string[]>([]);
  const [respDraft, setRespDraft] = useState("");
  const [kbIds, setKbIds] = useState<string[]>([]);
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [authority, setAuthority] = useState<string[]>(["tasks", "knowledge"]);
  const [communicationStyle, setCommunicationStyle] = useState("professional");
  const [decisionSpeed, setDecisionSpeed] = useState("balanced");
  const [autonomy, setAutonomy] = useState("medium");
  const [dailyTokenBudget, setDailyTokenBudget] = useState("");

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const canNext =
    step === 0
      ? name.trim() && title.trim() && departmentId
      : step === 1
        ? responsibilities.length > 0
        : true;

  function addResponsibility() {
    const v = respDraft.trim();
    if (!v) return;
    setResponsibilities((r) => [...r, v]);
    setRespDraft("");
  }

  async function hire() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const permissions = [
      ...new Set([
        ...BASE_PERMISSIONS,
        ...AUTHORITY.filter((a) => authority.includes(a.key)).flatMap((a) => a.permissions),
      ]),
    ];
    const systemPrompt = [
      `You are ${name.trim()}, ${title.trim()} at this company.`,
      `Your responsibilities: ${responsibilities.join("; ")}.`,
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
          description: responsibilities.join("; "),
          responsibilities,
          systemPrompt,
          permissions,
          toolIds,
          knowledgeBaseIds: kbIds,
          ...(managerId ? { managerId } : {}),
          ...(dailyTokenBudget ? { dailyTokenBudget: Number(dailyTokenBudget) } : {}),
          personality: { communicationStyle, decisionSpeed, autonomy },
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Hire failed (${res.status})`);
        return;
      }
      setHired({ id: body.id, name: body.name });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hire failed");
    } finally {
      setBusy(false);
    }
  }

  if (hired) {
    return (
      <div className="card max-w-2xl space-y-4 text-center">
        <div className="text-4xl">🎉</div>
        <h2 className="text-xl font-semibold">Welcome, {hired.name}.</h2>
        <p className="text-sm text-muted">
          They start on probation: interview them, run their evals, and promote them to active
          when they prove out.
        </p>
        <div className="flex justify-center gap-3">
          <Link href={`/employees/${hired.id}`} className="btn">
            Open their workspace
          </Link>
          <Link
            href="/employees"
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted hover:text-text"
          >
            Back to command center
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card max-w-2xl space-y-5">
      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`pill ${
              i === step
                ? "border-accent text-accent-soft"
                : i < step
                  ? "border-success/40 text-success"
                  : "text-muted"
            }`}
          >
            {i < step ? "✓ " : `${i + 1}. `}
            {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sarah" autoFocus />
          </Field>
          <Field label="Role title">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Content Strategist" />
          </Field>
          <Field label="Department">
            <select className="input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Reports to">
            <select className="input" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
              <option value="">No manager (reports to you)</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <Field label="What will they own? Add one responsibility at a time.">
            <div className="flex gap-2">
              <input
                className="input"
                value={respDraft}
                onChange={(e) => setRespDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addResponsibility())}
                placeholder="e.g. Draft weekly LinkedIn posts"
                autoFocus
              />
              <button type="button" className="btn shrink-0" onClick={addResponsibility}>
                Add
              </button>
            </div>
          </Field>
          <ul className="space-y-1.5">
            {responsibilities.map((r, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm">
                <span className="text-success">✓</span>
                <span className="flex-1">{r}</span>
                <button
                  type="button"
                  className="text-xs text-muted hover:text-danger"
                  onClick={() => setResponsibilities((list) => list.filter((_, j) => j !== i))}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {knowledgeBases.length > 0 && (
            <Field label="Knowledge — what should they know?">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {knowledgeBases.map((kb) => (
                  <Check key={kb.id} checked={kbIds.includes(kb.id)} onChange={() => toggle(kbIds, setKbIds, kb.id)} title={kb.label} />
                ))}
              </div>
            </Field>
          )}
          {tools.length > 0 && (
            <Field label="Tools — what can they use?">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {tools.map((t) => (
                  <Check
                    key={t.id}
                    checked={toolIds.includes(t.id)}
                    onChange={() => toggle(toolIds, setToolIds, t.id)}
                    title={t.id}
                    sub={t.description}
                    mono
                  />
                ))}
              </div>
            </Field>
          )}
        </div>
      )}

      {step === 3 && (
        <Field label="Authority — each switch grants real permissions">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {AUTHORITY.map((a) => (
              <Check
                key={a.key}
                checked={authority.includes(a.key)}
                onChange={() => toggle(authority, setAuthority, a.key)}
                title={a.label}
                sub={a.permissions.join(", ")}
              />
            ))}
          </div>
        </Field>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Communication">
              <select className="input" value={communicationStyle} onChange={(e) => setCommunicationStyle(e.target.value)}>
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
                <option value="concise">Concise</option>
                <option value="detailed">Detailed</option>
              </select>
            </Field>
            <Field label="Decision speed">
              <select className="input" value={decisionSpeed} onChange={(e) => setDecisionSpeed(e.target.value)}>
                <option value="deliberate">Deliberate</option>
                <option value="balanced">Balanced</option>
                <option value="fast">Fast</option>
              </select>
            </Field>
            <Field label="Autonomy">
              <select className="input" value={autonomy} onChange={(e) => setAutonomy(e.target.value)}>
                <option value="low">Low — ask often</option>
                <option value="medium">Medium</option>
                <option value="high">High — act freely</option>
              </select>
            </Field>
          </div>
          <Field label="Daily token budget (optional hard cap)">
            <input className="input" type="number" min={1} value={dailyTokenBudget} onChange={(e) => setDailyTokenBudget(e.target.value)} placeholder="e.g. 200000" />
          </Field>
          <div className="rounded-lg border border-info/30 bg-info/5 px-4 py-3 text-sm text-muted">
            New hires start on <span className="text-info">probation</span>: chattable and
            evaluable, but they take real work only after passing evals and being promoted.
          </div>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        {step > 0 && (
          <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm text-muted hover:text-text" onClick={() => setStep(step - 1)} disabled={busy}>
            ← Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn" onClick={() => setStep(step + 1)} disabled={!canNext}>
            Continue →
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => void hire()} disabled={busy}>
            {busy ? "Hiring…" : `Hire ${name.trim() || "employee"}`}
          </button>
        )}
        <button type="button" className="ml-auto text-sm text-muted hover:text-text" onClick={() => router.back()} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
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

function Check({
  checked,
  onChange,
  title,
  sub,
  mono,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition ${
        checked ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
      }`}
    >
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={onChange} />
      <span className="min-w-0">
        <span className={`block text-xs ${mono ? "font-mono" : "font-medium"}`}>{title}</span>
        {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
      </span>
    </label>
  );
}
