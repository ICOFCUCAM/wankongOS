/**
 * Model Context Protocol client over Streamable HTTP.
 *
 * Speaks JSON-RPC 2.0 to an MCP server endpoint: `initialize` →
 * `notifications/initialized` → `tools/list` / `tools/call`. Handles both
 * plain-JSON and SSE-framed responses, and echoes the server's
 * `mcp-session-id` once issued. Dependency-free (fetch only), so employees can
 * consume any MCP tool server — the whole MCP ecosystem — as tools.
 */

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpServerInfo {
  name?: string;
  version?: string;
}

export class McpError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "McpError";
  }
}

const PROTOCOL_VERSION = "2025-03-26";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpClient {
  private nextId = 0;
  private sessionId: string | null = null;
  private initialized = false;
  serverInfo: McpServerInfo = {};

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
  ) {}

  /** Initialize the session and return the server's tools. */
  async connect(): Promise<McpToolInfo[]> {
    const init = (await this.rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "wankongos", version: "0.1.0" },
    })) as { serverInfo?: McpServerInfo };
    this.serverInfo = init?.serverInfo ?? {};
    await this.notify("notifications/initialized");
    this.initialized = true;
    return this.listTools();
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.rpc("tools/list", {})) as { tools?: McpToolInfo[] };
    return result?.tools ?? [];
  }

  /** Call a tool; returns the concatenated text content of the result. */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.initialized) await this.connect();
    const result = (await this.rpc("tools/call", { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = (result?.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
    if (result?.isError) throw new McpError(text || `Tool "${name}" reported an error`);
    return text;
  }

  // --- transport -----------------------------------------------------------

  private async post(body: Record<string, unknown>): Promise<Response> {
    return fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        ...this.headers,
      },
      body: JSON.stringify(body),
    });
  }

  private async notify(method: string): Promise<void> {
    const res = await this.post({ jsonrpc: "2.0", method });
    // Notifications expect no body; 200/202/204 are all fine.
    if (!res.ok && res.status !== 202) {
      throw new McpError(`Notification ${method} failed (${res.status})`);
    }
    await res.body?.cancel().catch(() => undefined);
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++this.nextId;
    const res = await this.post({ jsonrpc: "2.0", id, method, params });
    if (!res.ok) {
      throw new McpError(`MCP ${method} failed: HTTP ${res.status}`, res.status);
    }
    const session = res.headers.get("mcp-session-id");
    if (session) this.sessionId = session;

    const contentType = res.headers.get("content-type") ?? "";
    const message = contentType.includes("text/event-stream")
      ? await this.readSseResponse(res, id)
      : ((await res.json()) as JsonRpcResponse);

    if (!message) throw new McpError(`MCP ${method}: no response for request ${id}`);
    if (message.error) throw new McpError(message.error.message, message.error.code);
    return message.result;
  }

  /** Read an SSE-framed body until the response matching `id` arrives. */
  private async readSseResponse(res: Response, id: number): Promise<JsonRpcResponse | null> {
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const parsed = JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
        if (parsed.id === id) return parsed;
      } catch {
        // Ignore non-JSON keep-alives.
      }
    }
    return null;
  }
}
