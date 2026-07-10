"use client";

import { useState } from "react";
import { PUBLIC_API_URL } from "@/lib/api";

interface Policy {
  id: string;
  name: string;
  kind: string;
  rules: string[];
  version: number;
}
export interface DnaShape {
  mission: string;
  vision: string;
  values: string[];
  style: { register: string; notes: string };
  riskAppetite: { level: string; notes: string };
  decisionRules: string[];
  approvalLimits: { autoApproveBelowUsd: number; alwaysEscalateAboveUsd: number; notes: string };
  preferredSuppliers: string[];
  industryStandards: string[];
  policies: Policy[];
}

const REGISTERS = ["formal", "friendly", "government", "academic", "plain"];

/**
 * The Company DNA editor. Saving updates the operating context every
 * employee consults on their next piece of work — no per-employee edits.
 */
export function DnaEditor({ initial }: { initial: DnaShape }) {
  const [dna, setDna] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/dna`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(dna),
      });
      if (!res.ok) {
        setError(`Save failed (${res.status})`);
        return;
      }
      setSaved(true);
    } catch {
      setError("Could not reach the API.");
    } finally {
      setBusy(false);
    }
  }

  const listField = (
    label: string,
    values: string[],
    onChange: (v: string[]) => void,
    placeholder: string,
  ) => (
    <label className="block text-xs text-muted">
      {label} (one per line)
      <textarea
        className="input mt-1 min-h-16"
        value={values.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n").filter((l) => l.trim()))}
        placeholder={placeholder}
      />
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="text-sm font-medium">Identity</h2>
        <label className="block text-xs text-muted">
          Mission
          <textarea className="input mt-1" value={dna.mission} onChange={(e) => setDna({ ...dna, mission: e.target.value })} />
        </label>
        <label className="block text-xs text-muted">
          Vision
          <textarea className="input mt-1" value={dna.vision} onChange={(e) => setDna({ ...dna, vision: e.target.value })} />
        </label>
        {listField("Values", dna.values, (values) => setDna({ ...dna, values }), "Evidence over opinion")}
      </div>

      <div className="card space-y-3">
        <h2 className="text-sm font-medium">Style &amp; risk</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs text-muted">
            Writing register (every employee adapts automatically)
            <select className="input mt-1" value={dna.style.register} onChange={(e) => setDna({ ...dna, style: { ...dna.style, register: e.target.value } })}>
              {REGISTERS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted">
            Risk appetite
            <select className="input mt-1" value={dna.riskAppetite.level} onChange={(e) => setDna({ ...dna, riskAppetite: { ...dna.riskAppetite, level: e.target.value } })}>
              {["low", "medium", "high"].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-xs text-muted">
          Style notes
          <input className="input mt-1" value={dna.style.notes} onChange={(e) => setDna({ ...dna, style: { ...dna.style, notes: e.target.value } })} />
        </label>
        {listField("Decision rules", dna.decisionRules, (decisionRules) => setDna({ ...dna, decisionRules }), "Never commit spend without an approval")}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-muted">
            Auto-approve below (USD)
            <input type="number" className="input mt-1" value={dna.approvalLimits.autoApproveBelowUsd} onChange={(e) => setDna({ ...dna, approvalLimits: { ...dna.approvalLimits, autoApproveBelowUsd: Number(e.target.value) } })} />
          </label>
          <label className="block text-xs text-muted">
            Always escalate above (USD)
            <input type="number" className="input mt-1" value={dna.approvalLimits.alwaysEscalateAboveUsd} onChange={(e) => setDna({ ...dna, approvalLimits: { ...dna.approvalLimits, alwaysEscalateAboveUsd: Number(e.target.value) } })} />
          </label>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="text-sm font-medium">Preferences</h2>
        {listField("Preferred suppliers", dna.preferredSuppliers, (preferredSuppliers) => setDna({ ...dna, preferredSuppliers }), "Nordic Steel AS")}
        {listField("Industry standards", dna.industryStandards, (industryStandards) => setDna({ ...dna, industryStandards }), "ISO 9001")}
      </div>

      <div className="card space-y-2">
        <h2 className="text-sm font-medium">Policies (the Policy Engine)</h2>
        <p className="text-xs text-muted">
          Central store — employees query these with the policy.lookup tool instead of relying
          on prompt text. Editing a policy bumps its version for every employee at once.
        </p>
        {dna.policies.map((p, i) => (
          <div key={p.id} className="rounded-lg border border-border p-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium">
                {p.name} <span className="text-muted">v{p.version} · {p.kind}</span>
              </span>
            </div>
            <textarea
              className="input min-h-14 !text-xs"
              value={p.rules.join("\n")}
              onChange={(e) =>
                setDna({
                  ...dna,
                  policies: dna.policies.map((x, j) =>
                    j === i ? { ...x, rules: e.target.value.split("\n").filter((l) => l.trim()) } : x,
                  ),
                })
              }
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="btn disabled:opacity-50">
          {busy ? "Saving…" : "Save Company DNA"}
        </button>
        {saved && <span className="text-xs text-success">Saved — every employee consults this on their next task.</span>}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </div>
  );
}
