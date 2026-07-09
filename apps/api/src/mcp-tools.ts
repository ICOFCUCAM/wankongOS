import { ToolRegistry } from "@wankong/agents";
import { McpClient } from "@wankong/integrations";
import type { Store } from "@wankong/store";

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "server"
  );
}

/** Employee tool id for an MCP server tool: `mcp.<integration-slug>.<tool>`. */
export function mcpToolId(slug: string, toolName: string): string {
  return `mcp.${slug}.${toolName}`.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
}

interface McpIntegrationConfig {
  url?: string;
  slug?: string;
  tools?: { name: string; description: string }[];
}

// One client per server URL, so sessions are reused across requests.
const clients = new Map<string, McpClient>();
function clientFor(url: string): McpClient {
  let client = clients.get(url);
  if (!client) {
    client = new McpClient(url);
    clients.set(url, client);
  }
  return client;
}

/**
 * Compose the effective tool registry for a request: the built-in tools plus a
 * proxy tool for every tool of every connected MCP integration. Proxies carry
 * the MCP tool's schema; the local provider triggers on the tool's name
 * appearing in the request, cloud models decide natively. Disconnecting an
 * integration removes its tools on the next request — no restart.
 */
export async function composeToolRegistry(
  base: ToolRegistry,
  store: Store,
  organizationId: string,
): Promise<ToolRegistry> {
  const integrations = await store.integrations.list(
    (i) => i.organizationId === organizationId && i.kind === "mcp" && i.status === "connected",
  );
  if (integrations.length === 0) return base;

  const registry = new ToolRegistry();
  for (const [id, tool] of base.entries()) registry.register(id, tool);

  for (const integration of integrations) {
    const config = integration.config as McpIntegrationConfig;
    if (!config.url || !config.slug) continue;
    for (const mcpTool of config.tools ?? []) {
      const id = mcpToolId(config.slug, mcpTool.name);
      const url = config.url;
      registry.register(id, {
        definition: {
          name: id,
          description: `[${integration.name}] ${mcpTool.description || mcpTool.name}`,
          parameters: { type: "object", properties: { text: { type: "string" } } },
          triggers: [escapeRegex(mcpTool.name).replace(/[_-]/g, "[ _-]")],
        },
        async run(args) {
          return clientFor(url).callTool(mcpTool.name, args);
        },
      });
    }
  }
  return registry;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
