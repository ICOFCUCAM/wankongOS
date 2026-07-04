import type { AIProvider, CompletionChunk, CompletionRequest } from "../types.js";
import { estimateTokens } from "../types.js";

/**
 * A deterministic, offline provider.
 *
 * This is NOT a stub — it is a real, dependency-free backend that lets the
 * entire platform run, demo, and be tested without any API keys or network. It
 * reads the employee's system prompt and the latest request, then composes a
 * grounded, role-aware reply: it restates the ask, lays out how the role would
 * approach it, and surfaces any escalation/approval considerations it detects.
 *
 * In production you point employees at `anthropic`/`openai`/`google`; the local
 * provider remains the guaranteed-available fallback and the engine that makes
 * CI hermetic.
 */
export class LocalProvider implements AIProvider {
  readonly id = "local" as const;
  readonly defaultModel = "wankong-local-1";

  async *stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const system = request.messages.find((m) => m.role === "system")?.content ?? "";
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    const persona = extractPersona(system);
    const reply = composeReply(persona, system, lastUser?.content ?? "");

    const inputTokens = request.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
    let outputTokens = 0;

    // Stream word-by-word so downstream streaming code is genuinely exercised.
    const words = reply.split(/(\s+)/);
    for (const w of words) {
      if (request.signal?.aborted) break;
      outputTokens += estimateTokens(w);
      yield { type: "text", delta: w };
    }

    yield {
      type: "done",
      usage: { inputTokens, outputTokens },
      finishReason: "stop",
    };
  }
}

interface Persona {
  name: string;
  title: string;
}

function extractPersona(system: string): Persona {
  const name = /You are ([^,\.]+?),/i.exec(system)?.[1]?.trim();
  const title = /,\s*the ([^\.]+?)(?:\.|\sat\s)/i.exec(system)?.[1]?.trim();
  return {
    name: name ?? "your AI colleague",
    title: title ?? "AI employee",
  };
}

function composeReply(persona: Persona, system: string, ask: string): string {
  const trimmed = ask.trim();
  if (!trimmed) {
    return `Hi, I'm ${persona.name}, your ${persona.title}. Tell me what you'd like handled and I'll take it from here.`;
  }

  const objectives = extractBullets(system, "Objectives");
  const responsibilities = extractBullets(system, "Responsibilities");
  const focus = responsibilities[0] ?? objectives[0] ?? "the outcome you're after";

  const steps = planSteps(persona.title, trimmed);
  const flags = governanceNotes(system, trimmed);

  const lines = [
    `Understood — here's how I'll approach "${summarize(trimmed)}" as your ${persona.title}.`,
    ``,
    `**Read on the request.** This maps most directly to ${focus}.`,
    ``,
    `**Plan.**`,
    ...steps.map((s, i) => `${i + 1}. ${s}`),
  ];

  if (flags.length > 0) {
    lines.push(``, `**Before I execute, note:**`, ...flags.map((f) => `- ${f}`));
  }

  lines.push(
    ``,
    `I can start immediately on the steps above, or adjust scope if you'd like. What would you prefer?`,
  );
  return lines.join("\n");
}

function planSteps(title: string, ask: string): string[] {
  const base = [
    `Clarify the definition of done and any constraints for "${summarize(ask)}".`,
    `Pull the relevant context from company knowledge and my own memory.`,
    `Draft the work and self-review it against my objectives and KPIs.`,
    `Deliver the result and log the outcome for auditability.`,
  ];
  const t = title.toLowerCase();
  if (t.includes("sales")) base.splice(2, 0, "Prioritise by expected pipeline value and close probability.");
  else if (t.includes("support") || t.includes("success"))
    base.splice(2, 0, "Check the customer's history and SLA before responding.");
  else if (t.includes("account") || t.includes("finance"))
    base.splice(2, 0, "Reconcile the numbers and confirm they tie out to source records.");
  else if (t.includes("legal"))
    base.splice(2, 0, "Flag any clause or obligation that needs a human attorney's sign-off.");
  else if (t.includes("recruit") || t.includes("hr"))
    base.splice(2, 0, "Screen against the role's must-have criteria before shortlisting.");
  return base;
}

function governanceNotes(system: string, ask: string): string[] {
  const notes: string[] = [];
  const lower = ask.toLowerCase();
  if (/(refund|discount|contract|payment|wire|sign|approve|budget)/.test(lower)) {
    notes.push(
      "This looks like it may cross an approval threshold — I'll route it for human approval before committing anything irreversible.",
    );
  }
  if (/escalat/i.test(system) && /(angry|urgent|legal|breach|complaint)/.test(lower)) {
    notes.push("The situation may match an escalation rule; I'll loop in the right person if so.");
  }
  return notes;
}

function extractBullets(system: string, heading: string): string[] {
  const re = new RegExp(`${heading}:\\n([\\s\\S]*?)(?:\\n\\n|$)`, "i");
  const block = re.exec(system)?.[1] ?? "";
  return block
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
}

function summarize(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 77)}…` : clean;
}
