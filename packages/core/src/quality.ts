import type { CompanyDna } from "./dna.js";
import { allEvidence, composeMarkdown, type ComposedDoc } from "./composition.js";

/**
 * The Quality Engine: every composed output passes one final, DETERMINISTIC
 * reviewer before release. Checks are transparent rules — grammar hygiene,
 * brand, formatting, policy, evidence, compliance — not a model's opinion,
 * so a block is always explainable and reproducible. "error" findings block
 * rendering; "warn" findings ship with the document's quality report.
 */

export interface QualityFinding {
  severity: "error" | "warn";
  check: "grammar" | "brand" | "formatting" | "policy" | "evidence" | "compliance" | "accessibility";
  message: string;
}

const PLACEHOLDER = /\b(lorem ipsum|TODO|TBD|FIXME|XXX|\[insert[^\]]*\]|placeholder)\b/i;
const CLAIM_TYPES = new Set(["contract_draft", "filing_paper", "brief"]);

export function runQualityChecks(
  doc: ComposedDoc,
  opts: { companyName: string; dna?: CompanyDna | null; safeguard?: string },
): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const md = composeMarkdown(doc);

  // grammar hygiene — mechanical, so never a false "quality" claim
  if (PLACEHOLDER.test(md)) {
    findings.push({ severity: "error", check: "grammar", message: "Placeholder text (TODO/TBD/lorem ipsum/[insert…]) must not ship." });
  }
  if (/ {2,}/.test(md.replace(/\n/g, ""))) {
    findings.push({ severity: "warn", check: "grammar", message: "Double spaces found." });
  }
  const opens = (md.match(/\(/g) ?? []).length;
  const closes = (md.match(/\)/g) ?? []).length;
  if (opens !== closes) {
    findings.push({ severity: "warn", check: "grammar", message: `Unbalanced parentheses (${opens} open, ${closes} close).` });
  }

  // brand — the company's own name spelled exactly right
  const first = opts.companyName.split(/\s+/)[0];
  if (first && first.length >= 4) {
    const wrong = new RegExp(`\\b${first.slice(0, first.length - 1)}[a-z]\\b`, "g");
    const hits = md.match(wrong) ?? [];
    for (const h of new Set(hits)) {
      if (h !== first && h.toLowerCase() !== first.toLowerCase()) {
        findings.push({ severity: "warn", check: "brand", message: `Possible misspelling of ${opts.companyName}: "${h}".` });
      }
    }
  }

  // formatting — heading order, empty table rows
  let lastLevel = 1;
  for (const s of doc.sections) {
    if (s.kind === "heading") {
      if (s.level > lastLevel + 1) {
        findings.push({ severity: "warn", check: "formatting", message: `Heading "${s.text}" skips a level (h${lastLevel} → h${s.level}).` });
      }
      lastLevel = s.level;
    }
    if (s.kind === "table" && s.rows.some((r) => r.length !== s.columns.length)) {
      findings.push({ severity: "error", check: "formatting", message: "Table rows must match the column count." });
    }
  }

  // policy — brand-policy rules that ban phrasings are enforced literally
  for (const policy of opts.dna?.policies ?? []) {
    if (policy.kind !== "brand") continue;
    for (const rule of policy.rules) {
      const m = /always written as (.+)$/i.exec(rule);
      if (m) {
        const canonical = m[1]!.trim();
        const loose = new RegExp(canonical.replace(/\s+/g, "\\s+"), "i");
        if (loose.test(md) && !md.includes(canonical)) {
          findings.push({ severity: "warn", check: "policy", message: `${policy.name} v${policy.version}: company name must be written exactly "${canonical}".` });
        }
      }
      const banned = /no superlatives/i.test(rule) && /\b(best-in-class|world-class|revolutionary|unbeatable)\b/i.test(md);
      if (banned) {
        findings.push({ severity: "warn", check: "policy", message: `${policy.name} v${policy.version}: superlative found without a cited benchmark.` });
      }
    }
  }

  // evidence — claim-bearing doc types must cite records
  if (CLAIM_TYPES.has(doc.docType) && allEvidence(doc).length === 0) {
    findings.push({ severity: "error", check: "evidence", message: `A ${doc.docType} must cite evidence (records) for its claims — none found.` });
  }

  // compliance — accounting/legal papers carry the safeguard; nothing claims to file
  if (doc.docType === "filing_paper" && opts.safeguard && !md.includes(opts.safeguard.slice(0, 60))) {
    findings.push({ severity: "error", check: "compliance", message: "Filing papers must carry the accounting review safeguard." });
  }
  if (/\b(we (have )?(filed|submitted)|automatically filed)\b/i.test(md)) {
    findings.push({ severity: "error", check: "compliance", message: "Documents must never claim a filing was submitted — the system does not submit." });
  }

  // accessibility — mechanical readability floors
  if (doc.sections.some((s) => s.kind === "paragraph" && s.text.length > 1200 && !s.text.includes("\n"))) {
    findings.push({ severity: "warn", check: "accessibility", message: "Very long unbroken paragraph — split for readability." });
  }
  if (doc.sections[0]?.kind === "paragraph" && doc.sections.length > 6 && !doc.sections.some((s) => s.kind === "heading")) {
    findings.push({ severity: "warn", check: "accessibility", message: "Long document without headings — add structure." });
  }

  return findings;
}
