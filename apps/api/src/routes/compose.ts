import { Hono } from "hono";
import { z } from "zod";
import {
  ACCOUNTING_SAFEGUARD,
  ComposedDoc,
  allEvidence,
  composeMarkdown,
  runQualityChecks,
  verificationCode,
  EvidenceRef,
} from "@wankong/core";
import type { Env } from "../context.js";
import { authorize, parseBody } from "../http.js";

/**
 * The Enterprise Composition Engine's API. POST /v1/compose takes the
 * structured representation, runs the shared engines in order — evidence
 * resolution (dangling refs are errors: proof must exist), the Quality
 * Engine (error findings block release with 422), branding — and renders
 * the target format as a stored, verifiable asset. Every department's
 * output goes through this one pipeline.
 */

const ComposeInput = z.object({
  doc: ComposedDoc,
  format: z.enum(["markdown", "pdf"]).default("markdown"),
});

export async function resolveEvidence(
  ctx: Env["Variables"]["ctx"],
  ref: EvidenceRef,
): Promise<{ exists: boolean; title: string; link: string }> {
  const orgOk = (owner?: { organizationId: string }) => owner?.organizationId === ctx.organizationId;
  switch (ref.type) {
    case "asset": {
      const a = await ctx.store.assets.get(ref.id);
      return { exists: orgOk(a ?? undefined), title: a?.title ?? ref.id, link: "/assets" };
    }
    case "task": {
      const t = await ctx.store.tasks.get(ref.id);
      return { exists: orgOk(t ?? undefined), title: t?.title ?? ref.id, link: "/tasks" };
    }
    case "conversation": {
      const c = await ctx.store.conversations.get(ref.id);
      return { exists: orgOk(c ?? undefined), title: c?.title ?? ref.id, link: c ? `/employees/${c.employeeId}` : "/employees" };
    }
    case "approval": {
      const a = await ctx.store.approvals.get(ref.id);
      return { exists: orgOk(a ?? undefined), title: a?.summary.slice(0, 80) ?? ref.id, link: "/tasks" };
    }
    case "journalEntry": {
      const e = await ctx.store.journalEntries.get(ref.id);
      return { exists: orgOk(e ?? undefined), title: e ? `${e.date} ${e.memo}`.trim() : ref.id, link: "/accounting" };
    }
    case "document": {
      const d = await ctx.store.documents.get(ref.id);
      return { exists: orgOk(d ?? undefined), title: d?.title ?? ref.id, link: "/knowledge" };
    }
    case "audit": {
      const e = await ctx.store.auditEvents.get(ref.id);
      return { exists: orgOk(e ?? undefined), title: e?.action ?? ref.id, link: "/pulse" };
    }
  }
}

export const composeRoutes = new Hono<Env>();

composeRoutes.post("/compose", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const { doc, format } = await parseBody(c, ComposeInput);

  // Evidence Engine: every cited record must exist in this organization.
  const evidence = allEvidence(doc);
  const resolved = await Promise.all(evidence.map((e) => resolveEvidence(ctx, e)));
  const dangling = evidence.filter((_, i) => !resolved[i]!.exists);
  if (dangling.length > 0) {
    return c.json(
      { error: "Evidence must resolve to stored records", dangling: dangling.map((d) => `${d.type}:${d.id}`) },
      422,
    );
  }

  // Quality Engine: transparent rules; errors block release.
  const [org, dna, kit] = await Promise.all([
    ctx.store.organizations.get(ctx.organizationId),
    ctx.store.companyDnas.listByOrg(ctx.organizationId).then((d) => d[0] ?? null),
    ctx.store.brandKits.list((b) => b.organizationId === ctx.organizationId).then((k) => k[0]),
  ]);
  const companyName = org?.name ?? "Company";
  const findings = runQualityChecks(doc, { companyName, dna, safeguard: ACCOUNTING_SAFEGUARD });
  if (findings.some((f) => f.severity === "error")) {
    return c.json({ error: "Quality Engine blocked release", findings }, 422);
  }

  const markdown = composeMarkdown(doc);
  const asset = await ctx.store.assets.create({
    organizationId: ctx.organizationId,
    studioId: "document",
    kind: `composed_${doc.docType}`,
    title: doc.title,
    mimeType: "text/markdown",
    content: markdown,
    version: 1,
    tags: ["composed", doc.docType, doc.status],
    createdBy: doc.author.employeeId
      ? { kind: "employee", id: doc.author.employeeId }
      : { kind: "user", id: c.get("actor").user.id },
  });

  const verify = verificationCode(asset.id, markdown);
  await ctx.store.assets.update(asset.id, { tags: [...asset.tags, `verify:${verify}`] });

  let pdfAssetId: string | undefined;
  if (format === "pdf") {
    const { buildBrandedPdf, markdownToLines } = await import("../studios/pdf.js");
    const pdf = buildBrandedPdf(doc.title, markdownToLines(markdown), {
      companyName,
      tagline: kit?.tagline,
      primaryHex: kit?.colors.primary ?? "#6d5efc",
      legalLine: `${companyName} — generated from recorded data by WankongOS; document no. ${asset.id}`,
      docNumber: asset.id,
      dateIso: new Date().toISOString().slice(0, 10),
      stamp: { line1: "COMPANY RECORD", line2: companyName.toUpperCase().slice(0, 28) },
      watermark: doc.status === "approved" ? "APPROVED" : doc.status.toUpperCase(),
      verification: verify,
      author: `${doc.author.name}${doc.author.department ? ` (${doc.author.department})` : ""}`,
      reviewer: doc.reviewer,
    });
    const pdfAsset = await ctx.store.assets.create({
      organizationId: ctx.organizationId,
      studioId: "document",
      kind: "pdf",
      title: `${doc.title}.pdf`,
      mimeType: "application/pdf",
      content: pdf.toString("base64"),
      version: 1,
      tags: ["composed", "pdf", doc.docType, `verify:${verify}`],
      createdBy: { kind: "user", id: c.get("actor").user.id },
    });
    pdfAssetId = pdfAsset.id;
  }

  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "compose.render",
    targetType: "asset",
    targetId: asset.id,
    metadata: { docType: doc.docType, status: doc.status, format, verify, warnings: findings.length },
  });

  return c.json(
    {
      assetId: asset.id,
      pdfAssetId,
      verification: verify,
      qualityReport: { findings, note: "Deterministic checks — every finding is a named rule, not a model opinion." },
      evidence: evidence.map((e, i) => ({ ...e, title: resolved[i]!.title, link: resolved[i]!.link })),
    },
    201,
  );
});

/** Verify a printed code against stored records — the QR precursor. */
composeRoutes.get("/verify/:code", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const code = c.req.param("code").toUpperCase();
  const matches = await ctx.store.assets.listByOrg(ctx.organizationId, (a) =>
    a.tags.includes(`verify:${code}`),
  );
  if (matches.length === 0) {
    return c.json({ verified: false, note: "No stored document carries this code — the paper does not match company records." }, 404);
  }
  return c.json({
    verified: true,
    documents: matches.map((a) => ({ id: a.id, title: a.title, kind: a.kind, createdAt: a.createdAt })),
    note: "Code matches the stored record(s) above. Content re-verification: recompute the code from the stored markdown.",
  });
});

/** Evidence Engine: resolve a citation to a stored record and its link. */
composeRoutes.get("/evidence/resolve", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const parsed = EvidenceRef.safeParse({ type: c.req.query("type"), id: c.req.query("id") });
  if (!parsed.success) return c.json({ error: "Pass ?type=<asset|task|...>&id=" }, 400);
  const r = await resolveEvidence(ctx, parsed.data);
  return c.json({ ...parsed.data, ...r });
});
