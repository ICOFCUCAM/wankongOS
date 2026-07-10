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
