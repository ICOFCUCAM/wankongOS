import {
  ACCOUNTING_SAFEGUARD,
  allEvidence,
  composeMarkdown,
  runQualityChecks,
  verificationCode,
  type ComposedDoc,
  type EvidenceRef,
  type QualityFinding,
} from "@wankong/core";
import type { Store } from "@wankong/store";

/**
 * The Enterprise Composition Engine's pipeline, shared by the /v1/compose
 * route and the doc.compose employee tool: evidence resolution → Quality
 * Engine → branded render → verifiable stored asset.
 */

export async function resolveEvidence(
  store: Store,
  organizationId: string,
  ref: EvidenceRef,
): Promise<{ exists: boolean; title: string; link: string }> {
  const orgOk = (owner?: { organizationId: string } | null) => owner?.organizationId === organizationId;
  switch (ref.type) {
    case "asset": {
      const a = await store.assets.get(ref.id);
      return { exists: orgOk(a), title: a?.title ?? ref.id, link: "/assets" };
    }
    case "task": {
      const t = await store.tasks.get(ref.id);
      return { exists: orgOk(t), title: t?.title ?? ref.id, link: "/tasks" };
    }
    case "conversation": {
      const c = await store.conversations.get(ref.id);
      return { exists: orgOk(c), title: c?.title ?? ref.id, link: c ? `/employees/${c.employeeId}` : "/employees" };
    }
    case "approval": {
      const a = await store.approvals.get(ref.id);
      return { exists: orgOk(a), title: a?.summary.slice(0, 80) ?? ref.id, link: "/tasks" };
    }
    case "journalEntry": {
      const e = await store.journalEntries.get(ref.id);
      return { exists: orgOk(e), title: e ? `${e.date} ${e.memo}`.trim() : ref.id, link: "/accounting" };
    }
    case "document": {
      const d = await store.documents.get(ref.id);
      return { exists: orgOk(d), title: d?.title ?? ref.id, link: "/knowledge" };
    }
    case "audit": {
      const e = await store.auditEvents.get(ref.id);
      return { exists: orgOk(e), title: e?.action ?? ref.id, link: "/pulse" };
    }
  }
}

export type ComposeOutcome =
  | {
      ok: true;
      assetId: string;
      pdfAssetId?: string;
      verification: string;
      findings: QualityFinding[];
      evidence: (EvidenceRef & { title: string; link: string })[];
    }
  | { ok: false; problems: string[]; findings: QualityFinding[] };

export async function composeAndRender(
  store: Store,
  organizationId: string,
  doc: ComposedDoc,
  format: "markdown" | "pdf",
  createdBy: { kind: "user" | "employee"; id: string },
): Promise<ComposeOutcome> {
  const evidence = allEvidence(doc);
  const resolved = await Promise.all(evidence.map((e) => resolveEvidence(store, organizationId, e)));
  const dangling = evidence.filter((_, i) => !resolved[i]!.exists);
  if (dangling.length > 0) {
    return { ok: false, problems: dangling.map((d) => `${d.type}:${d.id}`), findings: [] };
  }

  const [org, dna, kit] = await Promise.all([
    store.organizations.get(organizationId),
    store.companyDnas.listByOrg(organizationId).then((d) => d[0] ?? null),
    store.brandKits.list((b) => b.organizationId === organizationId).then((k) => k[0]),
  ]);
  const companyName = org?.name ?? "Company";
  const findings = runQualityChecks(doc, { companyName, dna, safeguard: ACCOUNTING_SAFEGUARD });
  const errors = findings.filter((f) => f.severity === "error");
  if (errors.length > 0) {
    return { ok: false, problems: errors.map((f) => `${f.check}: ${f.message}`), findings };
  }

  const markdown = composeMarkdown(doc);
  const asset = await store.assets.create({
    organizationId,
    studioId: "document",
    kind: `composed_${doc.docType}`,
    title: doc.title,
    mimeType: "text/markdown",
    content: markdown,
    version: 1,
    tags: ["composed", doc.docType, doc.status],
    createdBy,
  });
  const verification = verificationCode(asset.id, markdown);
  await store.assets.update(asset.id, { tags: [...asset.tags, `verify:${verification}`] });

  let pdfAssetId: string | undefined;
  if (format === "pdf") {
    const { buildBrandedPdf, markdownToLines } = await import("./studios/pdf.js");
    const pdf = buildBrandedPdf(doc.title, markdownToLines(markdown), {
      companyName,
      tagline: kit?.tagline,
      primaryHex: kit?.colors.primary ?? "#6d5efc",
      legalLine: `${companyName} — generated from recorded data by WankongOS; document no. ${asset.id}`,
      docNumber: asset.id,
      dateIso: new Date().toISOString().slice(0, 10),
      stamp: { line1: "COMPANY RECORD", line2: companyName.toUpperCase().slice(0, 28) },
      watermark: doc.status.toUpperCase(),
      verification,
      author: `${doc.author.name}${doc.author.department ? ` (${doc.author.department})` : ""}`,
      reviewer: doc.reviewer,
    });
    const pdfAsset = await store.assets.create({
      organizationId,
      studioId: "document",
      kind: "pdf",
      title: `${doc.title}.pdf`,
      mimeType: "application/pdf",
      content: pdf.toString("base64"),
      version: 1,
      tags: ["composed", "pdf", doc.docType, `verify:${verification}`],
      createdBy,
    });
    pdfAssetId = pdfAsset.id;
  }

  await store.audit({
    organizationId,
    actor: createdBy,
    action: "compose.render",
    targetType: "asset",
    targetId: asset.id,
    metadata: { docType: doc.docType, status: doc.status, format, verify: verification, warnings: findings.length },
  });

  return {
    ok: true,
    assetId: asset.id,
    pdfAssetId,
    verification,
    findings,
    evidence: evidence.map((e, i) => ({ ...e, title: resolved[i]!.title, link: resolved[i]!.link })),
  };
}
