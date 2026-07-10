"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Workflow, WorkflowNode, Condition } from "@wankong/core/workflow";
import { validateWorkflowGraph, nodeTargets } from "@wankong/core/workflow";
import { Permission, IntegrationKind } from "@wankong/core/enums";
import { PUBLIC_API_URL } from "@/lib/api";

/**
 * The visual workflow builder. It edits the SAME definition the engine runs —
 * no intermediate format — and mirrors the server's graph validation live
 * (`validateWorkflowGraph` from core), so the problems panel here and the 422
 * from the API can never disagree. Nodes are laid out by BFS depth from the
 * entry; edges are drawn from each node's real routing fields.
 */

export interface BuilderEmployee {
  id: string;
  name: string;
  title: string;
}

const NODE_ICON: Record<string, string> = {
  start: "●",
  employee: "◈",
  decision: "◆",
  approval: "⚑",
  notification: "✉",
  integration: "⧉",
  parallel: "⋔",
  end: "◼",
};

const NODE_TONE: Record<string, string> = {
  start: "border-accent/60",
  employee: "border-border",
  decision: "border-info/50",
  approval: "border-approval/50",
  notification: "border-border",
  integration: "border-border",
  parallel: "border-info/40",
  end: "border-success/50",
};

const CARD_W = 192;
const CARD_H = 64;
const COL_GAP = 72;
const ROW_GAP = 40;

function layout(nodes: WorkflowNode[], entryId: string): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const queue: [string, number][] = [[entryId, 0]];
  while (queue.length > 0) {
    const [id, d] = queue.shift()!;
    if (depth.has(id)) continue;
    depth.set(id, d);
    const node = byId.get(id);
    if (node) for (const t of nodeTargets(node)) queue.push([t.to, d + 1]);
  }
  const maxDepth = Math.max(0, ...depth.values());
  const columns = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? maxDepth + 1; // unreachable nodes park in a final column
    const col = columns.get(d) ?? [];
    col.push(n.id);
    columns.set(d, col);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of columns) {
    ids.forEach((id, row) => {
      pos.set(id, { x: 16 + d * (CARD_W + COL_GAP), y: 16 + row * (CARD_H + ROW_GAP) });
    });
  }
  return pos;
}

function nextNodeId(nodes: WorkflowNode[]): string {
  const max = nodes
    .map((n) => /^n(\d+)$/.exec(n.id))
    .filter(Boolean)
    .reduce((m, r) => Math.max(m, Number(r![1])), 0);
  return `n${max + 1}`;
}

/** "true"/"false"/numbers become typed values so eq/gt compare correctly. */
function parseConditionValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

export function WorkflowBuilder({
  employees,
  initial,
}: {
  employees: BuilderEmployee[];
  initial?: Workflow;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [trigger, setTrigger] = useState<{
    kind: "manual" | "schedule" | "event";
    schedule?: string;
    event?: string;
  }>(initial?.trigger ?? { kind: "manual" });
  const [entryNodeId, setEntryNodeId] = useState(initial?.entryNodeId ?? "n1");
  const [nodes, setNodes] = useState<WorkflowNode[]>(
    initial?.nodes ?? [
      { id: "n1", type: "start", name: "Start", next: "n2" },
      { id: "n2", type: "end", name: "Done", status: "completed" },
    ],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paramDrafts, setParamDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [serverProblems, setServerProblems] = useState<string[]>([]);

  const problems = useMemo(() => {
    const list = validateWorkflowGraph(nodes, entryNodeId);
    const known = new Set(employees.map((e) => e.id));
    for (const n of nodes) {
      if (n.type === "employee" && !known.has(n.employeeId)) {
        list.push(`Node "${n.id}" assigns work to an unknown employee.`);
      }
    }
    if (!name.trim()) list.push("The workflow needs a name.");
    return list;
  }, [nodes, entryNodeId, employees, name]);

  const positions = useMemo(() => layout(nodes, entryNodeId), [nodes, entryNodeId]);
  const canvasW = Math.max(560, ...[...positions.values()].map((p) => p.x + CARD_W + 32));
  const canvasH = Math.max(240, ...[...positions.values()].map((p) => p.y + CARD_H + 32));
  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const endFallback = nodes.find((n) => n.type === "end")?.id ?? entryNodeId;

  function patchNode(id: string, patch: Partial<WorkflowNode>) {
    setNodes((ns) => ns.map((n) => (n.id === id ? ({ ...n, ...patch } as WorkflowNode) : n)));
  }

  function addNode(type: WorkflowNode["type"]) {
    const id = nextNodeId(nodes);
    const to = endFallback;
    const fresh: WorkflowNode =
      type === "employee"
        ? { id, type, name: "AI step", employeeId: employees[0]?.id ?? "", prompt: "Handle {{input}} and report the result.", outputKey: "result", next: to }
        : type === "decision"
          ? { id, type, name: "Decision", branches: [{ when: { path: "result", op: "exists" }, to }], else: to }
          : type === "approval"
            ? { id, type, name: "Approval", summary: "Approve this step", requiredPermission: "task:approve" as const, onApprove: to, onReject: to }
            : type === "notification"
              ? { id, type, name: "Notify", channel: "inapp", message: "Workflow update: {{result}}", next: to }
              : type === "integration"
                ? { id, type, name: "Integration", integration: IntegrationKind.options[0]!, action: "send", params: {}, next: to }
                : type === "parallel"
                  ? { id, type, name: "Parallel", branches: [to], join: to }
                  : type === "end"
                    ? { id, type, name: "Done", status: "completed" as const }
                    : { id, type: "start", name: "Start", next: to };
    setNodes((ns) => [...ns, fresh]);
    setSelectedId(id);
  }

  function removeNode(id: string) {
    setNodes((ns) =>
      ns
        .filter((n) => n.id !== id)
        // Anything that routed to the deleted node falls back to an end node,
        // so the graph stays runnable instead of dangling.
        .map((n) => {
          const retarget = (t: string) => (t === id ? endFallback : t);
          switch (n.type) {
            case "start":
            case "employee":
            case "notification":
            case "integration":
              return { ...n, next: retarget(n.next) };
            case "decision":
              return { ...n, branches: n.branches.map((b) => ({ ...b, to: retarget(b.to) })), else: retarget(n.else) };
            case "approval":
              return { ...n, onApprove: retarget(n.onApprove), onReject: retarget(n.onReject) };
            case "parallel":
              return { ...n, branches: n.branches.map(retarget), join: retarget(n.join) };
            default:
              return n;
          }
        }),
    );
    setSelectedId(null);
  }

  async function save() {
    setSaving(true);
    setServerProblems([]);
    try {
      const body = JSON.stringify({
        name: name.trim(),
        description: description.trim() || undefined,
        trigger,
        entryNodeId,
        nodes,
        active: initial?.active ?? true,
      });
      const res = await fetch(
        initial ? `${PUBLIC_API_URL}/v1/workflows/${initial.id}` : `${PUBLIC_API_URL}/v1/workflows`,
        { method: initial ? "PUT" : "POST", headers: { "content-type": "application/json" }, body },
      );
      const data = await res.json();
      if (!res.ok) {
        setServerProblems(data.problems ?? [data.error ?? `Save failed (${res.status})`]);
        return;
      }
      router.push(`/workflows/${data.id}`);
      router.refresh();
    } catch {
      setServerProblems(["Could not reach the API."]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs text-muted">
          Name
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Inbound lead handling" />
        </label>
        <label className="text-xs text-muted">
          Description
          <input className="input mt-1" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this workflow automates" />
        </label>
        <div className="flex items-end gap-2">
          <label className="text-xs text-muted">
            Trigger
            <select
              className="input mt-1"
              value={trigger.kind}
              onChange={(e) => setTrigger({ kind: e.target.value as "manual" | "schedule" | "event" })}
            >
              <option value="manual">manual</option>
              <option value="schedule">schedule</option>
              <option value="event">event</option>
            </select>
          </label>
          {trigger.kind === "schedule" && (
            <label className="text-xs text-muted">
              Cron
              <input className="input mt-1 font-mono" value={trigger.schedule ?? ""} onChange={(e) => setTrigger({ ...trigger, schedule: e.target.value })} placeholder="0 9 * * 1-5" />
            </label>
          )}
          {trigger.kind === "event" && (
            <label className="text-xs text-muted">
              Event
              <input className="input mt-1" value={trigger.event ?? ""} onChange={(e) => setTrigger({ ...trigger, event: e.target.value })} placeholder="lead.created" />
            </label>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-muted">Add node:</span>
        {(["employee", "decision", "approval", "notification", "integration", "parallel", "end"] as const).map((t) => (
          <button key={t} type="button" onClick={() => addNode(t)} className="rounded-lg border border-dashed border-border px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent-soft">
            {NODE_ICON[t]} {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <div className="card overflow-x-auto !p-0">
          <div className="relative" style={{ width: canvasW, height: canvasH }}>
            <svg className="pointer-events-none absolute inset-0 text-muted/60" width={canvasW} height={canvasH}>
              {nodes.flatMap((n) => {
                const from = positions.get(n.id);
                if (!from) return [];
                return nodeTargets(n).map((t, i) => {
                  const to = positions.get(t.to);
                  if (!to) return null;
                  const sx = from.x + CARD_W;
                  const sy = from.y + CARD_H / 2;
                  const tx = to.x;
                  const ty = to.y + CARD_H / 2;
                  const mx = (sx + tx) / 2;
                  return (
                    <g key={`${n.id}-${i}`}>
                      <path d={`M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`} fill="none" stroke="currentColor" strokeWidth="1.5" />
                      <circle cx={tx} cy={ty} r="3" fill="currentColor" />
                      {nodeTargets(n).length > 1 && (
                        <text x={mx} y={(sy + ty) / 2 - 5} textAnchor="middle" className="fill-current text-[9px]">
                          {t.label}
                        </text>
                      )}
                    </g>
                  );
                });
              })}
            </svg>
            {nodes.map((n) => {
              const p = positions.get(n.id)!;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  className={`absolute rounded-xl border bg-surface-2 px-3 py-2 text-left text-sm transition hover:border-accent ${NODE_TONE[n.type] ?? "border-border"} ${selectedId === n.id ? "ring-2 ring-accent" : ""}`}
                  style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-accent-soft">{NODE_ICON[n.type]}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{n.name || n.id}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted">
                    <span className="font-mono">{n.id}</span>
                    <span>{n.type}</span>
                    {n.id === entryNodeId && <span className="text-accent-soft">entry</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card">
            {selected ? (
              <NodeInspector
                node={selected}
                nodes={nodes}
                employees={employees}
                entryNodeId={entryNodeId}
                paramDraft={paramDrafts[selected.id]}
                setParamDraft={(v) => setParamDrafts((d) => ({ ...d, [selected.id]: v }))}
                onPatch={(patch) => patchNode(selected.id, patch)}
                onDelete={() => removeNode(selected.id)}
                onMakeEntry={() => setEntryNodeId(selected.id)}
              />
            ) : (
              <p className="text-sm text-muted">
                Select a node to edit it. Routing (next / branches / approve-reject) is edited
                here and drawn on the canvas — the definition you see is the definition the
                engine runs.
              </p>
            )}
          </div>

          <div className="card">
            <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">
              {problems.length === 0 && serverProblems.length === 0 ? "Ready to save" : "Problems"}
            </h3>
            {[...problems, ...serverProblems].map((p, i) => (
              <p key={i} className="text-xs text-danger">
                • {p}
              </p>
            ))}
            {problems.length === 0 && serverProblems.length === 0 && (
              <p className="text-xs text-muted">Graph validates: every edge lands, an end node is reachable.</p>
            )}
            <button type="button" onClick={save} disabled={saving || problems.length > 0} className="btn mt-3 w-full disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? "Saving…" : initial ? "Save changes" : "Create workflow"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NodeSelect({
  label,
  value,
  nodes,
  onChange,
}: {
  label: string;
  value: string;
  nodes: WorkflowNode[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs text-muted">
      {label}
      <select className="input mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
        {nodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.id} — {n.name || n.type} ({n.type})
          </option>
        ))}
      </select>
    </label>
  );
}

function ConditionEditor({
  cond,
  onChange,
}: {
  cond: Condition;
  onChange: (c: Condition) => void;
}) {
  const ops = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "exists", "truthy"] as const;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5">
      <input className="input font-mono !text-xs" value={cond.path} onChange={(e) => onChange({ ...cond, path: e.target.value })} placeholder="lead.score" title="Dot-path into the run context" />
      <select className="input !text-xs" value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value as Condition["op"] })}>
        {ops.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {cond.op === "exists" || cond.op === "truthy" ? (
        <span className="self-center text-[10px] text-muted">no value</span>
      ) : (
        <input
          className="input font-mono !text-xs"
          value={cond.value === undefined ? "" : String(cond.value)}
          onChange={(e) => onChange({ ...cond, value: parseConditionValue(e.target.value) })}
          placeholder="80, true, text"
          title="Numbers and true/false are typed automatically"
        />
      )}
    </div>
  );
}

function NodeInspector({
  node,
  nodes,
  employees,
  entryNodeId,
  paramDraft,
  setParamDraft,
  onPatch,
  onDelete,
  onMakeEntry,
}: {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  employees: BuilderEmployee[];
  entryNodeId: string;
  paramDraft: string | undefined;
  setParamDraft: (v: string) => void;
  onPatch: (patch: Partial<WorkflowNode>) => void;
  onDelete: () => void;
  onMakeEntry: () => void;
}) {
  const paramText = paramDraft ?? (node.type === "integration" ? JSON.stringify(node.params, null, 2) : "");
  let paramsInvalid = false;
  if (node.type === "integration" && paramDraft !== undefined) {
    try {
      JSON.parse(paramDraft);
    } catch {
      paramsInvalid = true;
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          {NODE_ICON[node.type]} {node.type} <span className="font-mono text-xs text-muted">{node.id}</span>
        </h3>
        <div className="flex gap-2">
          {node.type === "start" && node.id !== entryNodeId && (
            <button type="button" onClick={onMakeEntry} className="text-xs text-accent-soft hover:underline">
              make entry
            </button>
          )}
          {node.id !== entryNodeId && (
            <button type="button" onClick={onDelete} className="text-xs text-danger hover:underline">
              delete
            </button>
          )}
        </div>
      </div>

      <label className="block text-xs text-muted">
        Label
        <input className="input mt-1" value={node.name ?? ""} onChange={(e) => onPatch({ name: e.target.value })} />
      </label>

      {node.type === "start" && <NodeSelect label="Next" value={node.next} nodes={nodes} onChange={(v) => onPatch({ next: v })} />}

      {node.type === "employee" && (
        <>
          <label className="block text-xs text-muted">
            AI employee
            <select className="input mt-1" value={node.employeeId} onChange={(e) => onPatch({ employeeId: e.target.value })}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} — {e.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted">
            Prompt <span className="font-mono">{"{{path}}"}</span> tokens fill from the run context
            <textarea className="input mt-1 min-h-20" value={node.prompt} onChange={(e) => onPatch({ prompt: e.target.value })} />
          </label>
          <label className="block text-xs text-muted">
            Output key (where the reply lands in context)
            <input className="input mt-1 font-mono" value={node.outputKey} onChange={(e) => onPatch({ outputKey: e.target.value })} />
          </label>
          <NodeSelect label="Next" value={node.next} nodes={nodes} onChange={(v) => onPatch({ next: v })} />
        </>
      )}

      {node.type === "decision" && (
        <>
          {node.branches.map((b, i) => (
            <div key={i} className="rounded-lg border border-border p-2">
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted">
                <span>Branch {i + 1}</span>
                {node.branches.length > 1 && (
                  <button type="button" className="text-danger hover:underline" onClick={() => onPatch({ branches: node.branches.filter((_, j) => j !== i) })}>
                    remove
                  </button>
                )}
              </div>
              <ConditionEditor cond={b.when} onChange={(when) => onPatch({ branches: node.branches.map((x, j) => (j === i ? { ...x, when } : x)) })} />
              <div className="mt-1.5">
                <NodeSelect label="Then go to" value={b.to} nodes={nodes} onChange={(to) => onPatch({ branches: node.branches.map((x, j) => (j === i ? { ...x, to } : x)) })} />
              </div>
            </div>
          ))}
          <button
            type="button"
            className="text-xs text-accent-soft hover:underline"
            onClick={() => onPatch({ branches: [...node.branches, { when: { path: "result", op: "exists" as const }, to: node.else }] })}
          >
            + add branch
          </button>
          <NodeSelect label="Else" value={node.else} nodes={nodes} onChange={(v) => onPatch({ else: v })} />
        </>
      )}

      {node.type === "approval" && (
        <>
          <label className="block text-xs text-muted">
            What the approver sees
            <textarea className="input mt-1 min-h-16" value={node.summary} onChange={(e) => onPatch({ summary: e.target.value })} />
          </label>
          <label className="block text-xs text-muted">
            Required permission
            <select className="input mt-1 font-mono" value={node.requiredPermission} onChange={(e) => onPatch({ requiredPermission: e.target.value as typeof node.requiredPermission })}>
              {Permission.options.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <NodeSelect label="On approve" value={node.onApprove} nodes={nodes} onChange={(v) => onPatch({ onApprove: v })} />
          <NodeSelect label="On reject" value={node.onReject} nodes={nodes} onChange={(v) => onPatch({ onReject: v })} />
        </>
      )}

      {node.type === "notification" && (
        <>
          <label className="block text-xs text-muted">
            Channel
            <select className="input mt-1" value={node.channel} onChange={(e) => onPatch({ channel: e.target.value as typeof node.channel })}>
              <option value="inapp">in-app</option>
              <option value="slack">slack</option>
              <option value="email">email</option>
            </select>
          </label>
          <label className="block text-xs text-muted">
            Message <span className="font-mono">{"{{path}}"}</span> tokens supported
            <textarea className="input mt-1 min-h-16" value={node.message} onChange={(e) => onPatch({ message: e.target.value })} />
          </label>
          <label className="block text-xs text-muted">
            To (optional)
            <input className="input mt-1" value={node.to ?? ""} onChange={(e) => onPatch({ to: e.target.value || undefined })} />
          </label>
          <NodeSelect label="Next" value={node.next} nodes={nodes} onChange={(v) => onPatch({ next: v })} />
        </>
      )}

      {node.type === "integration" && (
        <>
          <label className="block text-xs text-muted">
            Integration
            <select className="input mt-1" value={node.integration} onChange={(e) => onPatch({ integration: e.target.value as typeof node.integration })}>
              {IntegrationKind.options.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted">
            Action
            <input className="input mt-1 font-mono" value={node.action} onChange={(e) => onPatch({ action: e.target.value })} />
          </label>
          <label className="block text-xs text-muted">
            Params (JSON)
            <textarea
              className={`input mt-1 min-h-16 font-mono !text-xs ${paramsInvalid ? "!border-danger" : ""}`}
              value={paramText}
              onChange={(e) => {
                setParamDraft(e.target.value);
                try {
                  onPatch({ params: JSON.parse(e.target.value) });
                } catch {
                  // keep typing; the field shows red until it parses
                }
              }}
            />
            {paramsInvalid && <span className="text-[10px] text-danger">Not valid JSON yet — last valid value is kept.</span>}
          </label>
          <label className="block text-xs text-muted">
            Output key (optional)
            <input className="input mt-1 font-mono" value={node.outputKey ?? ""} onChange={(e) => onPatch({ outputKey: e.target.value || undefined })} />
          </label>
          <NodeSelect label="Next" value={node.next} nodes={nodes} onChange={(v) => onPatch({ next: v })} />
        </>
      )}

      {node.type === "parallel" && (
        <>
          {node.branches.map((b, i) => (
            <div key={i} className="flex items-end gap-1.5">
              <div className="flex-1">
                <NodeSelect label={`Branch ${i + 1}`} value={b} nodes={nodes} onChange={(v) => onPatch({ branches: node.branches.map((x, j) => (j === i ? v : x)) })} />
              </div>
              {node.branches.length > 1 && (
                <button type="button" className="pb-2 text-xs text-danger hover:underline" onClick={() => onPatch({ branches: node.branches.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              )}
            </div>
          ))}
          <button type="button" className="text-xs text-accent-soft hover:underline" onClick={() => onPatch({ branches: [...node.branches, node.join] })}>
            + add branch
          </button>
          <NodeSelect label="Join at" value={node.join} nodes={nodes} onChange={(v) => onPatch({ join: v })} />
        </>
      )}

      {node.type === "end" && (
        <label className="block text-xs text-muted">
          Run finishes as
          <select className="input mt-1" value={node.status} onChange={(e) => onPatch({ status: e.target.value as typeof node.status })}>
            <option value="completed">completed</option>
            <option value="failed">failed</option>
          </select>
        </label>
      )}
    </div>
  );
}
