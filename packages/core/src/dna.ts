import { z } from "zod";

const Id = z.string().min(1).max(80);
const Timestamp = z.string().datetime();

/**
 * Company DNA — the organization's persistent operating context. Every AI
 * employee consults it before working: mission, values, writing style, risk
 * appetite, decision rules, approval limits, and the central policy store
 * (policies live HERE, not buried in prompt text, so updating a policy
 * updates every employee at once). One DNA record per organization.
 */

export const StyleRegister = z.enum(["formal", "friendly", "government", "academic", "plain"]);
export type StyleRegister = z.infer<typeof StyleRegister>;

export const PolicyKind = z.enum([
  "travel",
  "expense",
  "hr",
  "legal",
  "brand",
  "security",
  "accounting",
  "custom",
]);
export type PolicyKind = z.infer<typeof PolicyKind>;

export const CompanyPolicy = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  kind: PolicyKind,
  /** The policy's rules as plain, citable statements. */
  rules: z.array(z.string().min(1).max(500)).min(1).max(50),
  version: z.number().int().min(1).default(1),
});
export type CompanyPolicy = z.infer<typeof CompanyPolicy>;

export const CompanyDna = z.object({
  id: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  organizationId: Id,
  mission: z.string().max(1000).default(""),
  vision: z.string().max(1000).default(""),
  values: z.array(z.string().max(200)).max(20).default([]),
  /** Company Style Engine: how this company writes, everywhere. */
  style: z
    .object({
      register: StyleRegister.default("formal"),
      notes: z.string().max(1000).default(""),
    })
    .default({ register: "formal", notes: "" }),
  riskAppetite: z
    .object({
      level: z.enum(["low", "medium", "high"]).default("low"),
      notes: z.string().max(1000).default(""),
    })
    .default({ level: "low", notes: "" }),
  decisionRules: z.array(z.string().max(300)).max(30).default([]),
  /** Spend thresholds employees must respect when recommending actions. */
  approvalLimits: z
    .object({
      autoApproveBelowUsd: z.number().min(0).default(0),
      alwaysEscalateAboveUsd: z.number().min(0).default(1000),
      notes: z.string().max(500).default(""),
    })
    .default({ autoApproveBelowUsd: 0, alwaysEscalateAboveUsd: 1000, notes: "" }),
  preferredSuppliers: z.array(z.string().max(200)).max(50).default([]),
  industryStandards: z.array(z.string().max(200)).max(30).default([]),
  /** The Policy Engine's central store. */
  policies: z.array(CompanyPolicy).max(40).default([]),
});
export type CompanyDna = z.infer<typeof CompanyDna>;

/** Render DNA as the compact prompt section every employee receives. */
export function dnaPromptSection(dna: CompanyDna): string {
  const lines: string[] = [];
  if (dna.mission) lines.push(`Mission: ${dna.mission}`);
  if (dna.values.length) lines.push(`Values: ${dna.values.join("; ")}`);
  lines.push(`Writing style: ${dna.style.register}${dna.style.notes ? ` — ${dna.style.notes}` : ""}`);
  lines.push(
    `Risk appetite: ${dna.riskAppetite.level}${dna.riskAppetite.notes ? ` — ${dna.riskAppetite.notes}` : ""}`,
  );
  if (dna.decisionRules.length) lines.push(`Decision rules: ${dna.decisionRules.join(" | ")}`);
  lines.push(
    `Approval limits: auto-approve below $${dna.approvalLimits.autoApproveBelowUsd}; ALWAYS escalate above $${dna.approvalLimits.alwaysEscalateAboveUsd}.`,
  );
  if (dna.policies.length) {
    lines.push(
      `Company policies (query the policy engine for full text): ${dna.policies.map((p) => `${p.name} v${p.version}`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

/** Policies relevant to a lookup query — simple, deterministic matching. */
export function findPolicies(dna: CompanyDna, query: string): CompanyPolicy[] {
  const q = query.toLowerCase();
  return dna.policies.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.kind.includes(q) ||
      p.rules.some((r) => r.toLowerCase().includes(q)),
  );
}
