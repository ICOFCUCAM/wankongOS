import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { McpClient, McpError } from "@wankong/integrations";

/**
 * A genuine (minimal) MCP server over Streamable HTTP: JSON-RPC 2.0 with
 * initialize / initialized / tools list+call, session id issuance, and one
 * SSE-framed response path — so the client is tested against the real wire
 * protocol, in-process.
 */
const calls: { name: string; args: Record<string, unknown>; session: string | null }[] = [];

function buildServer(): Hono {
  const app = new Hono();
  app.post("/mcp", async (c) => {
    const body = await c.req.json();
    const session = c.req.header("mcp-session-id") ?? null;

    if (body.method === "initialize") {
      c.header("mcp-session-id", "sess-123");
      return c.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "test-crm", version: "1.0.0" },
        },
      });
    }
    if (body.method === "notifications/initialized") {
      return c.body(null, 202);
    }
    if (body.method === "tools/list") {
      // SSE-framed response: clients must handle both framings.
      return c.body(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "lookup_order",
                description: "Look up an order's status by any customer detail.",
                inputSchema: { type: "object", properties: { text: { type: "string" } } },
              },
            ],
          },
        })}\n\n`,
        200,
        { "content-type": "text/event-stream" },
      );
    }
    if (body.method === "tools/call") {
      calls.push({ name: body.params.name, args: body.params.arguments, session });
      if (body.params.name === "explode") {
        return c.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { isError: true, content: [{ type: "text", text: "boom" }] },
        });
      }
      return c.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          content: [
            { type: "text", text: `Order #4821: shipped Tuesday (query: ${body.params.arguments.text})` },
          ],
        },
      });
    }
    return c.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "no such method" } });
  });
  return app;
}

let close: () => void;
let url: string;

beforeAll(async () => {
  const server = serve({ fetch: buildServer().fetch, port: 0 });
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  url = `http://127.0.0.1:${port}/mcp`;
  close = () => server.close();
});

afterAll(() => close());

describe("McpClient", () => {
  it("initializes, captures the session, and lists tools (SSE-framed)", async () => {
    const client = new McpClient(url);
    const tools = await client.connect();
    expect(client.serverInfo.name).toBe("test-crm");
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("lookup_order");
  });

  it("calls tools with the session id and returns text content", async () => {
    const client = new McpClient(url);
    await client.connect();
    const result = await client.callTool("lookup_order", { text: "where is BigCo's order?" });
    expect(result).toContain("Order #4821: shipped Tuesday");
    expect(calls.at(-1)!.session).toBe("sess-123");
  });

  it("surfaces tool errors as McpError", async () => {
    const client = new McpClient(url);
    await client.connect();
    await expect(client.callTool("explode", {})).rejects.toThrowError(McpError);
  });

  it("rejects unknown methods with the server's error", async () => {
    const client = new McpClient(url);
    await client.connect();
    await expect(
      (client as unknown as { rpc(m: string, p: object): Promise<unknown> }).rpc("nope", {}),
    ).rejects.toThrowError(/no such method/);
  });
});
