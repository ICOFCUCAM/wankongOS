import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { LocalEmbedder } from "@wankong/knowledge";
import { createApp } from "../src/app.js";
import { createAppContext, type AppContext } from "../src/context.js";

/** Minimal but protocol-faithful MCP server the org will connect to. */
const toolCalls: Record<string, unknown>[] = [];

function mcpServer(): Hono {
  const app = new Hono();
  app.post("/mcp", async (c) => {
    const body = await c.req.json();
    switch (body.method) {
      case "initialize":
        c.header("mcp-session-id", "s1");
        return c.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "acme-crm", version: "1.0.0" },
          },
        });
      case "notifications/initialized":
        return c.body(null, 202);
      case "tools/list":
        return c.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "lookup_order",
                description: "Look up an order's shipping status.",
                inputSchema: { type: "object", properties: { text: { type: "string" } } },
              },
            ],
          },
        });
      case "tools/call":
        toolCalls.push(body.params);
        return c.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: "Order #4821 for BigCo: shipped, arriving Thursday." }] },
        });
      default:
        return c.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "nope" } });
    }
  });
  return app;
}

let mcpUrl: string;
let closeServer: () => void;
let context: AppContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const server = serve({ fetch: mcpServer().fetch, port: 0 });
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  mcpUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  closeServer = () => server.close();
});

afterAll(() => closeServer());

beforeEach(() => {
  context = createAppContext({
    store: createSeededStore(),
    registry: new ProviderRegistry(),
    embedder: new LocalEmbedder(),
    organizationId: SEED_ORG_ID,
  });
  app = createApp({ context, quiet: true });
});

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("M4b: MCP tool support", () => {
  it("connects an MCP server, discovers tools, and returns assignable tool ids", async () => {
    const res = await app.request(
      "/v1/integrations",
      json({ kind: "mcp", name: "Acme CRM", config: { url: mcpUrl } }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("connected");
    expect(body.toolIds).toEqual(["mcp.acme-crm.lookup_order"]);
    expect(body.config.server.name).toBe("acme-crm");

    const list = await (await app.request("/v1/integrations")).json();
    expect(list.data).toHaveLength(1);
  });

  it("an employee uses an MCP tool from chat, grounded in the server's answer", async () => {
    const connect = await (
      await app.request(
        "/v1/integrations",
        json({ kind: "mcp", name: "Acme CRM", config: { url: mcpUrl } }),
      )
    ).json();

    // Grant the discovered tool to the support manager.
    await app.request("/v1/employees/emp_support_manager", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolIds: connect.toolIds }),
    });

    const before = toolCalls.length;
    const body = await (
      await app.request(
        "/v1/employees/emp_support_manager/chat",
        json({ input: "Please lookup_order for BigCo — customer is asking." }),
      )
    ).json();

    expect(toolCalls.length).toBe(before + 1);
    expect(body.tools[0].name).toBe("mcp.acme-crm.lookup_order");
    expect(body.tools[0].ok).toBe(true);
    expect(body.reply).toContain("shipped, arriving Thursday");
  });

  it("disconnecting the integration removes its tools on the next request", async () => {
    const connect = await (
      await app.request(
        "/v1/integrations",
        json({ kind: "mcp", name: "Acme CRM", config: { url: mcpUrl } }),
      )
    ).json();
    await app.request("/v1/employees/emp_support_manager", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolIds: connect.toolIds }),
    });
    await app.request(`/v1/integrations/${connect.id}`, { method: "DELETE" });

    const before = toolCalls.length;
    const body = await (
      await app.request(
        "/v1/employees/emp_support_manager/chat",
        json({ input: "Please lookup_order for BigCo." }),
      )
    ).json();
    expect(toolCalls.length).toBe(before);
    expect(body.tools).toHaveLength(0);
  });

  it("rejects an unreachable MCP server with 502, storing nothing", async () => {
    const res = await app.request(
      "/v1/integrations",
      json({ kind: "mcp", name: "Ghost", config: { url: "http://127.0.0.1:9/mcp" } }),
    );
    expect(res.status).toBe(502);
    expect(await context.store.integrations.count()).toBe(0);
  });

  it("requires integration:manage to connect", async () => {
    const res = await app.request("/v1/integrations", {
      ...json({ kind: "mcp", name: "X", config: { url: mcpUrl } }),
      headers: { "content-type": "application/json", "x-demo-role": "member" },
    });
    expect(res.status).toBe(403);
  });
});
