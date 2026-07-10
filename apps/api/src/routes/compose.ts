import { Hono } from "hono";
import { z } from "zod";
import { ComposedDoc, EvidenceRef } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize, parseBody } from "../http.js";
import { composeAndRender, resolveEvidence } from "../composition.js";

/**
 * The Enterprise Composition Engine's API. POST /v1/compose takes the
 * structured representation and runs the shared pipeline — evidence
 * resolution (dangling refs are errors: proof must exist), the Quality
 * Engine (error findings block release with 422), branded render into a
 * stored, verifiable asset. Every department's output goes through this
 * one pipeline; improving one engine improves them all.
 */

const ComposeInput = z.object({
  doc: ComposedDoc,
  format: z.enum(["markdown", "pdf", "deck"]).default("markdown"),
});

export const composeRoutes = new Hono<Env>();

composeRoutes.post("/compose", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const { doc, format } = await parseBody(c, ComposeInput);
  const createdBy = doc.author.employeeId
    ? ({ kind: "employee", id: doc.author.employeeId } as const)
    : ({ kind: "user", id: c.get("actor").user.id } as const);
  const result = await composeAndRender(ctx.store, ctx.organizationId, doc, format, createdBy);
  if (!result.ok) {
    const danglingOnly = result.findings.length === 0;
    return c.json(
      danglingOnly
        ? { error: "Evidence must resolve to stored records", dangling: result.problems }
        : { error: "Quality Engine blocked release", findings: result.findings, problems: result.problems },
      422,
    );
  }
  return c.json(
    {
      assetId: result.assetId,
      pdfAssetId: result.pdfAssetId,
      deckAssetId: result.deckAssetId,
      verification: result.verification,
      qualityReport: {
        findings: result.findings,
        note: "Deterministic checks — every finding is a named rule, not a model opinion.",
      },
      evidence: result.evidence,
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
    return c.json(
      { verified: false, note: "No stored document carries this code — the paper does not match company records." },
      404,
    );
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
  const r = await resolveEvidence(ctx.store, ctx.organizationId, parsed.data);
  return c.json({ ...parsed.data, ...r });
});
