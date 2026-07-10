import { z } from "zod";

/**
 * The Enterprise Composition Engine's data model (ADR-0030). Every output —
 * report, contract draft, invoice, presentation, brief — first becomes this
 * STRUCTURED representation with semantic sections and metadata, then passes
 * through the shared engines (branding, style, quality, evidence) before
 * rendering to a target format. Improving one engine improves every
 * department's output at once.
 */

/** A citation to a stored record — the Evidence Engine's unit of proof. */
export const EvidenceRef = z.object({
  type: z.enum(["asset", "task", "conversation", "approval", "journalEntry", "document", "audit"]),
  id: z.string().min(1),
  note: z.string().max(300).optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const DocSection = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("heading"), text: z.string().min(1).max(200), level: z.number().int().min(1).max(3).default(2) }),
  z.object({
    kind: z.literal("paragraph"),
    text: z.string().min(1).max(8000),
    /** Claims in this paragraph trace to these records. */
    evidence: z.array(EvidenceRef).max(10).default([]),
  }),
  z.object({ kind: z.literal("list"), items: z.array(z.string().min(1).max(500)).min(1).max(50) }),
  z.object({
    kind: z.literal("table"),
    columns: z.array(z.string().min(1).max(80)).min(1).max(12),
    rows: z.array(z.array(z.string().max(200))).max(200),
  }),
  z.object({ kind: z.literal("kv"), pairs: z.array(z.object({ key: z.string().max(80), value: z.string().max(500) })).min(1).max(40) }),
  z.object({ kind: z.literal("note"), text: z.string().min(1).max(2000) }),
  z.object({
    kind: z.literal("slide"),
    title: z.string().min(1).max(160),
    bullets: z.array(z.string().max(300)).max(10).default([]),
    speakerNotes: z.string().max(2000).default(""),
    /** Optional bar chart: label/value pairs rendered as branded SVG. */
    chart: z.object({ title: z.string().max(120), bars: z.array(z.object({ label: z.string().max(40), value: z.number() })).min(1).max(12) }).optional(),
  }),
]);
export type DocSection = z.infer<typeof DocSection>;

export const DocStatus = z.enum(["draft", "internal", "confidential", "approved"]);
export type DocStatus = z.infer<typeof DocStatus>;

export const ComposedDoc = z.object({
  title: z.string().min(1).max(200),
  docType: z.enum(["report", "brief", "contract_draft", "invoice", "proposal", "presentation", "memo", "filing_paper"]),
  language: z.string().min(2).max(12).default("en"),
  status: DocStatus.default("draft"),
  author: z.object({ employeeId: z.string().optional(), name: z.string().max(120), department: z.string().max(120).optional() }),
  reviewer: z.string().max(120).optional(),
  sections: z.array(DocSection).min(1).max(200),
});
export type ComposedDoc = z.infer<typeof ComposedDoc>;

/** Render the structured doc to markdown — the canonical stored form. */
export function composeMarkdown(doc: ComposedDoc): string {
  const parts: string[] = [`# ${doc.title}`];
  for (const s of doc.sections) {
    switch (s.kind) {
      case "heading":
        parts.push(`${"#".repeat(s.level + 1)} ${s.text}`);
        break;
      case "paragraph":
        parts.push(
          s.evidence.length > 0
            ? `${s.text}\n\n${s.evidence.map((e) => `> Evidence: ${e.type} ${e.id}${e.note ? ` — ${e.note}` : ""}`).join("\n")}`
            : s.text,
        );
        break;
      case "list":
        parts.push(s.items.map((i) => `- ${i}`).join("\n"));
        break;
      case "table":
        parts.push(
          [`| ${s.columns.join(" | ")} |`, `| ${s.columns.map(() => "---").join(" | ")} |`, ...s.rows.map((r) => `| ${r.join(" | ")} |`)].join("\n"),
        );
        break;
      case "kv":
        parts.push(s.pairs.map((p) => `**${p.key}:** ${p.value}`).join("  \n"));
        break;
      case "note":
        parts.push(`> ${s.text}`);
        break;
      case "slide":
        parts.push(
          `## Slide: ${s.title}\n\n${s.bullets.map((b) => `- ${b}`).join("\n")}${s.speakerNotes ? `\n\n> Speaker notes: ${s.speakerNotes}` : ""}`,
        );
        break;
    }
  }
  return parts.join("\n\n") + "\n";
}

/** Every evidence reference in the document, deduplicated. */
export function allEvidence(doc: ComposedDoc): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const s of doc.sections) {
    if (s.kind !== "paragraph") continue;
    for (const e of s.evidence) {
      const key = `${e.type}:${e.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    }
  }
  return out;
}

/**
 * A deterministic verification code for a rendered document: content hash
 * (FNV-1a over the markdown + doc number) formatted for the footer. Paired
 * with GET /v1/verify/:code it proves a paper matches its stored record —
 * the honest precursor to QR rendering.
 */
export function verificationCode(docNumber: string, markdown: string): string {
  let h = 0x811c9dc5;
  const input = `${docNumber}\n${markdown}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `WK-${h.toString(16).toUpperCase().padStart(8, "0")}`;
}
