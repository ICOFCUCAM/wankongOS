import { Hono } from "hono";
import { z } from "zod";
import { Permission } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize, findScoped, parseBody } from "../http.js";
import { generateApiKey } from "../auth.js";

const CreateKey = z.object({
  name: z.string().min(1).max(120),
  /** Permissions this key grants. Least privilege: nothing by default. */
  scopes: z.array(Permission).min(1),
});

export const apiKeyRoutes = new Hono<Env>();

/** List keys (prefix + metadata only — never the secret). */
apiKeyRoutes.get("/api-keys", async (c) => {
  authorize(c, "apikey:manage");
  const ctx = c.get("ctx");
  const keys = await ctx.store.apiKeys.list((k) => k.organizationId === ctx.organizationId);
  return c.json({
    data: keys.map(({ hashedKey: _h, ...rest }) => rest),
  });
});

/** Create a key. The plaintext appears ONCE in this response, then only its hash exists. */
apiKeyRoutes.post("/api-keys", async (c) => {
  authorize(c, "apikey:manage");
  const ctx = c.get("ctx");
  const { name, scopes } = await parseBody(c, CreateKey);

  // A key can only grant what its creator holds — no privilege escalation.
  const actor = c.get("actor");
  const beyond = scopes.filter((s) => !actor.permissions.has(s));
  if (beyond.length > 0) {
    return c.json({ error: `Cannot grant scopes you don't hold: ${beyond.join(", ")}` }, 403);
  }

  const generated = generateApiKey();
  const key = await ctx.store.apiKeys.create({
    organizationId: ctx.organizationId,
    name,
    hashedKey: generated.hashedKey,
    prefix: generated.prefix,
    scopes,
  });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: actor.user.id },
    action: "apikey.create",
    targetType: "apiKey",
    targetId: key.id,
    metadata: { name, scopes },
  });
  return c.json(
    {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      scopes: key.scopes,
      /** Shown once — store it now. */
      key: generated.plaintext,
    },
    201,
  );
});

/** Revoke a key. Revocation is immediate and permanent. */
apiKeyRoutes.delete("/api-keys/:id", async (c) => {
  authorize(c, "apikey:manage");
  const ctx = c.get("ctx");
  const key = await findScoped(c, (id) => ctx.store.apiKeys.get(id), c.req.param("id"));
  const updated = await ctx.store.apiKeys.update(key.id, {
    revokedAt: new Date().toISOString(),
  });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "apikey.revoke",
    targetType: "apiKey",
    targetId: key.id,
    metadata: { name: key.name },
  });
  return c.json({ id: updated.id, revokedAt: updated.revokedAt });
});
