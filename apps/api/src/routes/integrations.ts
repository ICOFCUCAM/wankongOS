import { Hono } from "hono";
import { z } from "zod";
import { McpClient, McpError } from "@wankong/integrations";
import type { Env } from "../context.js";
import { authorize, findScoped, parseBody } from "../http.js";
import { mcpToolId, slugify } from "../mcp-tools.js";

const ConnectMcp = z.object({
  kind: z.literal("mcp"),
  name: z.string().min(1).max(120),
  config: z.object({ url: z.string().url() }),
});

export const integrationRoutes = new Hono<Env>();

/** Connected integrations (config secrets never included; MCP has none yet). */
integrationRoutes.get("/integrations", async (c) => {
  authorize(c, "integration:read");
  const ctx = c.get("ctx");
  const integrations = await ctx.store.integrations.list(
    (i) => i.organizationId === ctx.organizationId,
  );
  return c.json({ data: integrations });
});

/**
 * Connect an MCP server: initialize the session, discover its tools, and store
 * the integration. Discovered tools become assignable employee tools with ids
 * `mcp.<integration-slug>.<tool>`.
 */
integrationRoutes.post("/integrations", async (c) => {
  authorize(c, "integration:manage");
  const ctx = c.get("ctx");
  const input = await parseBody(c, ConnectMcp);

  const slug = slugify(input.name);
  const client = new McpClient(input.config.url);
  let tools;
  try {
    tools = await client.connect();
  } catch (err) {
    const message = err instanceof McpError ? err.message : "Could not reach the MCP server";
    return c.json({ error: `MCP connection failed: ${message}` }, 502);
  }

  const integration = await ctx.store.integrations.create({
    organizationId: ctx.organizationId,
    kind: "mcp",
    name: input.name,
    status: "connected",
    config: {
      url: input.config.url,
      slug,
      server: client.serverInfo,
      tools: tools.map((t) => ({ name: t.name, description: t.description ?? "" })),
    },
  });

  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "integration.connect",
    targetType: "integration",
    targetId: integration.id,
    metadata: { kind: "mcp", name: input.name, tools: tools.map((t) => t.name) },
  });

  return c.json(
    {
      ...integration,
      /** Assign these ids to employees' toolIds to grant the tools. */
      toolIds: tools.map((t) => mcpToolId(slug, t.name)),
    },
    201,
  );
});

/** Disconnect an integration; its tools stop resolving immediately. */
integrationRoutes.delete("/integrations/:id", async (c) => {
  authorize(c, "integration:manage");
  const ctx = c.get("ctx");
  const integration = await findScoped(
    c,
    (id) => ctx.store.integrations.get(id),
    c.req.param("id"),
  );
  await ctx.store.integrations.delete(integration.id);
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "integration.disconnect",
    targetType: "integration",
    targetId: integration.id,
    metadata: { name: integration.name },
  });
  return c.json({ deleted: integration.id });
});
