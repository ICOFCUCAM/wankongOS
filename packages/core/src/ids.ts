import { randomUUID } from "node:crypto";

/**
 * Entity id prefixes. Prefixed ids make logs, URLs, and error messages
 * self-describing (`emp_3f2a...` is unambiguously an employee) and prevent a
 * whole class of "passed the wrong id" bugs.
 */
export const ID_PREFIXES = {
  organization: "org",
  workspace: "ws",
  department: "dept",
  team: "team",
  employee: "emp",
  user: "usr",
  task: "task",
  workflow: "wf",
  workflowRun: "wfr",
  knowledgeBase: "kb",
  document: "doc",
  conversation: "conv",
  message: "msg",
  goal: "goal",
  memory: "mem",
  approval: "appr",
  report: "rpt",
  integration: "intg",
  apiKey: "key",
  webhook: "whk",
  auditEvent: "evt",
  evalSuite: "evs",
  evalReport: "evr",
  asset: "ast",
  journalEntry: "jnl",
  accountingPeriod: "prd",
  company: "cmp",
  bankTransaction: "btx",
  fxRate: "fxr",
  fixedAsset: "fxa",
  interview: "ivw",
  notification: "ntf",
  brand: "brd",
  employeeVersion: "empv",
  healthSnapshot: "hsn",
} as const;

export type EntityKind = keyof typeof ID_PREFIXES;
export type PrefixedId<K extends EntityKind> = `${(typeof ID_PREFIXES)[K]}_${string}`;

/** Generate a fresh prefixed id for the given entity kind. */
export function newId<K extends EntityKind>(kind: K): PrefixedId<K> {
  const raw = randomUUID().replace(/-/g, "").slice(0, 24);
  return `${ID_PREFIXES[kind]}_${raw}` as PrefixedId<K>;
}

/** Type guard: does `id` carry the prefix for `kind`? */
export function isId<K extends EntityKind>(kind: K, id: string): id is PrefixedId<K> {
  return id.startsWith(`${ID_PREFIXES[kind]}_`);
}
