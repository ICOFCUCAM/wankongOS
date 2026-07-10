/**
 * PII redaction for the memory/knowledge boundary (§3.4).
 *
 * Deliberately conservative pattern set — emails, card numbers, SSNs, and
 * clearly-formatted phone numbers — because false positives corrupt memories.
 * Redactions are typed placeholders so downstream text stays readable and
 * auditable about WHAT was removed.
 */

interface Rule {
  label: string;
  pattern: RegExp;
  /** Optional extra validation on the raw match. */
  validate?: (match: string) => boolean;
}

/** Luhn checksum — filters random digit runs from real card numbers. */
function luhnValid(raw: string): boolean {
  const digits = raw.replace(/[\s-]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const RULES: Rule[] = [
  {
    label: "email",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    label: "card",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    validate: luhnValid,
  },
  {
    label: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    // Unambiguously-formatted phones only — space-separated digit runs are NOT
    // matched (they collide with order/reference numbers): requires a leading
    // "+", a parenthesized area code, or dash/dot-separated triples.
    label: "phone",
    pattern:
      /\+\d{1,3}[ .-]?\(?\d{2,4}\)?[ .-]?\d{3}[ .-]?\d{3,6}\b|\(\d{2,4}\)[ .-]?\d{3}[ .-]?\d{3,4}\b|\b\d{3}[.-]\d{3}[.-]\d{4}\b/g,
    validate: (m) => m.replace(/\D/g, "").length >= 7,
  },
];

export interface RedactionResult {
  text: string;
  redactions: { label: string; count: number }[];
}

/** Redact PII, returning the cleaned text and what was removed. */
export function redactPii(input: string): RedactionResult {
  let text = input;
  const counts = new Map<string, number>();

  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match) => {
      if (rule.validate && !rule.validate(match)) return match;
      counts.set(rule.label, (counts.get(rule.label) ?? 0) + 1);
      return `[redacted:${rule.label}]`;
    });
  }

  return {
    text,
    redactions: [...counts.entries()].map(([label, count]) => ({ label, count })),
  };
}
