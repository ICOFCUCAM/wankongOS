/**
 * Prompt-injection heuristics (defense in depth, §Security).
 *
 * Pattern-based detection of instruction-override attempts in UNTRUSTED text
 * (ingested documents, external tool output). Heuristics can't guarantee
 * safety — the primary defenses are structural (untrusted content is fenced as
 * data in prompts, tools are permission-gated in code) — but flagging suspect
 * content at ingestion gives humans a review signal and an audit trail.
 */

interface InjectionPattern {
  label: string;
  re: RegExp;
}

const PATTERNS: InjectionPattern[] = [
  {
    label: "instruction-override",
    re: /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|all|earlier|your)\b[^.\n]{0,40}\b(instructions?|prompts?|rules?)\b/i,
  },
  {
    label: "persona-override",
    re: /\byou are (now|no longer)\b|\bact as if you (are|were)\b|\bpretend (to be|you are)\b/i,
  },
  {
    label: "prompt-exfiltration",
    re: /\b(reveal|show|print|repeat|output|display)\b[^.\n]{0,40}\b(system prompt|hidden instructions?|your instructions?)\b/i,
  },
  {
    label: "mode-override",
    re: /\b(developer|dan|god|jailbreak(ed)?) mode\b|\bwithout (any )?(restrictions?|filters?|limitations?)\b/i,
  },
  {
    label: "instruction-injection",
    re: /\bnew instructions?\s*:/i,
  },
];

export interface InjectionScan {
  suspicious: boolean;
  findings: string[];
}

/** Scan text for instruction-override attempts. Pure and deterministic. */
export function detectPromptInjection(text: string): InjectionScan {
  const findings: string[] = [];
  for (const { label, re } of PATTERNS) {
    if (re.test(text)) findings.push(label);
  }
  return { suspicious: findings.length > 0, findings };
}
