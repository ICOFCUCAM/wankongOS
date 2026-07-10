import { Hono } from "hono";
import { Asset, BrandKit, STUDIOS } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize, findScoped, parseBody } from "../http.js";
import { z } from "zod";
import { generate, StudioError } from "../studios/generate.js";

const CreateAsset = Asset.omit({ id: true, createdAt: true, updatedAt: true, organizationId: true, createdBy: true, version: true });
const UpdateAsset = CreateAsset.partial();
const PutBrand = BrandKit.omit({ id: true, createdAt: true, updatedAt: true, organizationId: true }).partial();

export const studioRoutes = new Hono<Env>();

/**
 * The studio catalog with LIVE availability: builtin studios are always on;
 * connector studios light up only when a matching integration is connected.
 * Availability is derived, never asserted.
 */
studioRoutes.get("/studios", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const integrations = await ctx.store.integrations.list(
    (i) => i.organizationId === ctx.organizationId,
  );
  const connected = new Set(integrations.map((i) => i.kind.toLowerCase()));
  const data = STUDIOS.map((s) => {
    const matched = (s.connectors ?? []).filter((k) => connected.has(k.toLowerCase()));
    return {
      ...s,
      active: s.availability === "builtin" || matched.length > 0,
      connectedVia: matched,
    };
  });
  return c.json({ data });
});

/** Assets: list (filter by studio/tag/q), create, get, update (bumps version). */
studioRoutes.get("/assets", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const studio = c.req.query("studioId");
  const tag = c.req.query("tag");
  const q = c.req.query("q")?.toLowerCase();
  const assets = await ctx.store.assets.list(
    (a) =>
      a.organizationId === ctx.organizationId &&
      (studio ? a.studioId === studio : true) &&
      (tag ? a.tags.includes(tag) : true) &&
      (q ? a.title.toLowerCase().includes(q) || a.tags.some((t) => t.includes(q)) : true),
  );
  assets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return c.json({
    data: assets.map(({ content, ...meta }) => ({ ...meta, bytes: content.length })),
  });
});

studioRoutes.post("/assets", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const input = await parseBody(c, CreateAsset);
  const asset = await ctx.store.assets.create({
    ...input,
    organizationId: ctx.organizationId,
    version: 1,
    createdBy: { kind: "user", id: c.get("actor").user.id },
  });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "asset.create",
    targetType: "asset",
    targetId: asset.id,
    metadata: { title: asset.title, studioId: asset.studioId },
  });
  return c.json(asset, 201);
});

studioRoutes.get("/assets/:id", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const asset = await findScoped(c, (id) => ctx.store.assets.get(id), c.req.param("id"));
  return c.json(asset);
});

studioRoutes.patch("/assets/:id", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const existing = await findScoped(c, (id) => ctx.store.assets.get(id), c.req.param("id"));
  const patch = await parseBody(c, UpdateAsset);
  const updated = await ctx.store.assets.update(existing.id, {
    ...patch,
    version: existing.version + 1,
  });
  return c.json(updated);
});

/** The org's brand kit — created with defaults on first read. */
studioRoutes.get("/brand", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const kits = await ctx.store.brandKits.list((b) => b.organizationId === ctx.organizationId);
  if (kits[0]) return c.json(kits[0]);
  const created = await ctx.store.brandKits.create(
    BrandKit.omit({ id: true, createdAt: true, updatedAt: true }).parse({
      organizationId: ctx.organizationId,
      colors: {},
    }),
  );
  return c.json(created);
});

studioRoutes.put("/brand", async (c) => {
  authorize(c, "org:manage");
  const ctx = c.get("ctx");
  const patch = await parseBody(c, PutBrand);
  const kits = await ctx.store.brandKits.list((b) => b.organizationId === ctx.organizationId);
  const existing =
    kits[0] ??
    (await ctx.store.brandKits.create(
      BrandKit.omit({ id: true, createdAt: true, updatedAt: true }).parse({
        organizationId: ctx.organizationId,
        colors: {},
      }),
    ));
  const updated = await ctx.store.brandKits.update(existing.id, patch as never);
  return c.json(updated);
});


const GenerateInput = z.object({
  kind: z.string().min(1).max(60),
  title: z.string().max(200).optional(),
  data: z.record(z.unknown()).optional(),
});

/** Run a builtin generator and store the result as a versioned asset. */
studioRoutes.post("/studios/:studioId/generate", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const studioId = c.req.param("studioId");
  const input = await parseBody(c, GenerateInput);
  try {
    const result = await generate(ctx, studioId, input);
    const asset = await ctx.store.assets.create({
      organizationId: ctx.organizationId,
      studioId,
      version: 1,
      createdBy: { kind: "user", id: c.get("actor").user.id },
      ...result,
    });
    await ctx.store.audit({
      organizationId: ctx.organizationId,
      actor: { kind: "user", id: c.get("actor").user.id },
      action: "studio.generate",
      targetType: "asset",
      targetId: asset.id,
      metadata: { studioId, kind: result.kind, title: result.title },
    });
    return c.json(asset, 201);
  } catch (e) {
    if (e instanceof StudioError) return c.json({ error: e.message }, 422);
    throw e;
  }
});

const PublishInput = z.object({
  text: z.string().min(1).max(4000),
  title: z.string().max(200).optional(),
});

/**
 * Publishing Studio, live: posts through a connected channel (Slack today;
 * LinkedIn/X/WordPress attach the same way) and stores the published post
 * as an asset with its delivery result. No connected channel → honest 422.
 */
studioRoutes.post("/studios/publishing/publish", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const input = await parseBody(c, PublishInput);
  const { deliverSlack } = await import("../notify.js");
  const delivery = await deliverSlack(ctx.store, ctx.organizationId, input.text);
  if (!delivery.delivered) {
    return c.json({ error: `No connected publishing channel: ${delivery.reason}. Connect one in the Integration Hub.` }, 422);
  }
  const asset = await ctx.store.assets.create({
    organizationId: ctx.organizationId,
    studioId: "publishing",
    kind: "post",
    title: input.title ?? `Post ${new Date().toISOString().slice(0, 16)}`,
    mimeType: "text/markdown",
    content: `${input.text}\n\n---\nPublished via Slack · delivered`,
    version: 1,
    tags: ["publishing", "slack"],
    createdBy: { kind: "user", id: c.get("actor").user.id },
  });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "studio.publish",
    targetType: "asset",
    targetId: asset.id,
    metadata: { channel: "slack", title: asset.title },
  });
  return c.json({ asset, delivery }, 201);
});

const IssueInput = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  title: z.string().min(1).max(250),
  body: z.string().max(20000).optional(),
});

/**
 * Engineering Studio, live: file a GitHub issue through a connected
 * integration (config: { token }). The created issue is recorded as an
 * asset with its URL. No integration → honest 422.
 */
studioRoutes.post("/studios/engineering/issue", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const input = await parseBody(c, IssueInput);
  const integration = (
    await ctx.store.integrations.list(
      (i) => i.organizationId === ctx.organizationId && i.kind === "github" && i.status === "connected",
    )
  )[0];
  const token = (integration?.config as { token?: string } | undefined)?.token;
  if (!token) {
    return c.json({ error: "No connected GitHub integration. Connect one (config: { token }) in the Integration Hub." }, 422);
  }
  const res = await fetch(`https://api.github.com/repos/${input.repo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "wankongos",
    },
    body: JSON.stringify({ title: input.title, body: input.body ?? "" }),
  });
  if (!res.ok) {
    return c.json({ error: `GitHub responded ${res.status}`, detail: (await res.text()).slice(0, 300) }, 502);
  }
  const issue = (await res.json()) as { number: number; html_url: string };
  const asset = await ctx.store.assets.create({
    organizationId: ctx.organizationId,
    studioId: "engineering",
    kind: "issue",
    title: `${input.repo}#${issue.number}: ${input.title}`,
    mimeType: "text/markdown",
    content: `# ${input.title}\n\n${input.body ?? ""}\n\nFiled: ${issue.html_url}`,
    version: 1,
    tags: ["engineering", "github"],
    createdBy: { kind: "user", id: c.get("actor").user.id },
  });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "studio.engineering.issue",
    targetType: "asset",
    targetId: asset.id,
    metadata: { repo: input.repo, issue: issue.number },
  });
  return c.json({ asset, issue: { number: issue.number, url: issue.html_url } }, 201);
});

/** Render any text/markdown asset to a real PDF asset (builtin writer). */
studioRoutes.post("/assets/:id/render-pdf", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const source = await findScoped(c, (id) => ctx.store.assets.get(id), c.req.param("id"));
  if (!source.mimeType.startsWith("text/")) {
    return c.json({ error: `Only text assets render to PDF (got ${source.mimeType}).` }, 422);
  }
  const { buildBrandedPdf, markdownToLines } = await import("../studios/pdf.js");
  const [org, kit] = await Promise.all([
    ctx.store.organizations.get(ctx.organizationId),
    ctx.store.brandKits.list((b) => b.organizationId === ctx.organizationId).then((k) => k[0]),
  ]);
  const companyName = org?.name ?? "Company";
  const pdf = buildBrandedPdf(source.title, markdownToLines(source.content), {
    companyName,
    tagline: kit?.tagline,
    primaryHex: kit?.colors.primary ?? "#6d5efc",
    legalLine: `${companyName} — generated from recorded data by WankongOS; document no. ${source.id}`,
    docNumber: source.id,
    dateIso: new Date().toISOString().slice(0, 10),
    stamp: { line1: "COMPANY RECORD", line2: companyName.toUpperCase().slice(0, 28) },
  });
  const asset = await ctx.store.assets.create({
    organizationId: ctx.organizationId,
    studioId: "document",
    kind: "pdf",
    title: `${source.title}.pdf`,
    mimeType: "application/pdf",
    content: pdf.toString("base64"),
    version: 1,
    tags: [...source.tags, "pdf"],
    createdBy: { kind: "user", id: c.get("actor").user.id },
  });
  return c.json({ id: asset.id, title: asset.title, bytes: pdf.length }, 201);
});

/** Download an asset as its real file (decodes base64 for binary types). */
studioRoutes.get("/assets/:id/download", async (c) => {
  authorize(c, "org:read");
  const ctx = c.get("ctx");
  const asset = await findScoped(c, (id) => ctx.store.assets.get(id), c.req.param("id"));
  const binary = !asset.mimeType.startsWith("text/") && !asset.mimeType.includes("json") && !asset.mimeType.includes("svg");
  const body = binary ? Buffer.from(asset.content, "base64") : asset.content;
  return new Response(body, {
    headers: {
      "content-type": asset.mimeType,
      "content-disposition": `attachment; filename="${asset.title.replace(/[^\w.-]+/g, "_")}"`,
    },
  });
});

const UploadInput = z.object({
  title: z.string().min(1).max(200),
  mimeType: z.string().min(3).max(100),
  /** Base64 payload. Inline storage caps at ~350KB binary (500k chars); larger files need an object-storage connector. */
  base64: z.string().min(4).max(500_000),
  tags: z.array(z.string().max(40)).max(10).optional(),
});

/** Upload any file as a versioned asset (base64 inline; small-file floor). */
studioRoutes.post("/assets/upload", async (c) => {
  authorize(c, "task:create");
  const ctx = c.get("ctx");
  const input = await parseBody(c, UploadInput);
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(input.base64)) {
    return c.json({ error: "Payload must be base64" }, 400);
  }
  const asset = await ctx.store.assets.create({
    organizationId: ctx.organizationId,
    studioId: "assets",
    kind: "upload",
    title: input.title,
    mimeType: input.mimeType,
    content: input.base64,
    version: 1,
    tags: input.tags ?? ["upload"],
    createdBy: { kind: "user", id: c.get("actor").user.id },
  });
  return c.json({ id: asset.id, title: asset.title, bytes: Math.floor(input.base64.length * 0.75) }, 201);
});
