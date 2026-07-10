import { Hono } from "hono";
import { z } from "zod";
import { detectPromptInjection } from "@wankong/core";
import { embedChunks, prepareChunks } from "@wankong/knowledge";
import type { Env } from "../context.js";
import { authorize, findScoped, parseBody } from "../http.js";
import { searchKnowledge } from "../retrieval.js";

const IngestInput = z.object({
  knowledgeBaseId: z.string().min(3),
  title: z.string().min(1).max(240),
  content: z.string().min(1).max(500_000),
  mimeType: z.enum(["text/plain", "text/markdown", "text/csv"]).default("text/markdown"),
});

const SearchInput = z.object({
  query: z.string().min(1).max(2000),
  knowledgeBaseIds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

export const knowledgeRoutes = new Hono<Env>();

/** Knowledge bases with document counts. */
knowledgeRoutes.get("/knowledge-bases", async (c) => {
  authorize(c, "knowledge:read");
  const ctx = c.get("ctx");
  const [bases, docs] = await Promise.all([
    ctx.store.knowledgeBases.list((kb) => kb.organizationId === ctx.organizationId),
    ctx.store.documents.list((d) => d.organizationId === ctx.organizationId),
  ]);
  const counts = new Map<string, number>();
  for (const d of docs) counts.set(d.knowledgeBaseId, (counts.get(d.knowledgeBaseId) ?? 0) + 1);
  return c.json({
    data: bases.map((kb) => ({ ...kb, documentCount: counts.get(kb.id) ?? 0 })),
  });
});

/** Documents in a knowledge base (metadata only — content via the document route). */
knowledgeRoutes.get("/knowledge-bases/:id/documents", async (c) => {
  authorize(c, "knowledge:read");
  const ctx = c.get("ctx");
  const kb = await findScoped(c, (id) => ctx.store.knowledgeBases.get(id), c.req.param("id"));
  const docs = await ctx.store.documents.list((d) => d.knowledgeBaseId === kb.id);
  return c.json({
    data: docs.map((d) => ({
      id: d.id,
      title: d.title,
      mimeType: d.mimeType,
      version: d.version,
      chunkCount: d.chunks.length,
      updatedAt: d.updatedAt,
    })),
  });
});

/** Full document content. */
knowledgeRoutes.get("/documents/:id", async (c) => {
  authorize(c, "knowledge:read");
  const ctx = c.get("ctx");
  const doc = await findScoped(c, (id) => ctx.store.documents.get(id), c.req.param("id"));
  const { chunks, ...rest } = doc;
  return c.json({ ...rest, chunkCount: chunks.length });
});

/**
 * Ingest a document: chunk, embed, and store. Re-ingesting the same title into
 * the same knowledge base creates a new version of the existing document.
 */
knowledgeRoutes.post("/documents", async (c) => {
  authorize(c, "knowledge:write");
  const ctx = c.get("ctx");
  const input = await parseBody(c, IngestInput);
  const kb = await findScoped(c, (id) => ctx.store.knowledgeBases.get(id), input.knowledgeBaseId);

  const chunks = await embedChunks(prepareChunks(input.content, input.mimeType), ctx.embedder);

  const existing = (
    await ctx.store.documents.list((d) => d.knowledgeBaseId === kb.id && d.title === input.title)
  )[0];

  const doc = existing
    ? await ctx.store.documents.update(existing.id, {
        content: input.content,
        mimeType: input.mimeType,
        chunks,
        version: existing.version + 1,
      })
    : await ctx.store.documents.create({
        organizationId: ctx.organizationId,
        knowledgeBaseId: kb.id,
        title: input.title,
        mimeType: input.mimeType,
        content: input.content,
        version: 1,
        chunks,
      });

  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: existing ? "document.reingest" : "document.ingest",
    targetType: "document",
    targetId: doc.id,
    metadata: { title: doc.title, version: doc.version, chunks: chunks.length },
  });

  // Injection screening (defense in depth): suspect documents are flagged for
  // review and audited — retrieval still fences all knowledge as data, so a
  // flag is a review signal, not the only line of defense.
  const scan = detectPromptInjection(input.content);
  if (scan.suspicious) {
    await ctx.store.audit({
      organizationId: ctx.organizationId,
      actor: { kind: "user", id: c.get("actor").user.id },
      action: "document.injection_flagged",
      targetType: "document",
      targetId: doc.id,
      metadata: { title: doc.title, findings: scan.findings },
    });
  }

  return c.json(
    {
      id: doc.id,
      title: doc.title,
      version: doc.version,
      chunkCount: chunks.length,
      ...(scan.suspicious ? { injectionWarning: scan.findings } : {}),
    },
    existing ? 200 : 201,
  );
});

/** Semantic search across the organization's knowledge, returning citations. */
knowledgeRoutes.post("/knowledge/search", async (c) => {
  authorize(c, "knowledge:read");
  const ctx = c.get("ctx");
  const { query, knowledgeBaseIds, limit } = await parseBody(c, SearchInput);
  const citations = await searchKnowledge(ctx.store, ctx.organizationId, ctx.embedder, query, {
    knowledgeBaseIds,
    limit,
  });
  return c.json({ query, data: citations });
});
