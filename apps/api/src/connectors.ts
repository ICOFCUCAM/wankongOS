import type { ConnectorRegistry } from "@wankong/workflow";
import type { AppContext } from "./context.js";

/**
 * Upgrade hermetic default connectors to credentialed ones when a matching
 * integration is connected. Falls back to the queued (side-effect-free)
 * behaviour when no integration exists, so demos and tests stay hermetic and
 * connecting an integration changes workflow behaviour without a restart.
 */
export function applyCredentialedConnectors(
  registry: ConnectorRegistry,
  ctx: AppContext,
): ConnectorRegistry {
  registry.register("rest", async (action, params, { organizationId }) => {
    const integration = (
      await ctx.store.integrations.list(
        (i) => i.organizationId === organizationId && i.kind === "rest" && i.status === "connected",
      )
    )[0];
    if (!integration) return { status: "queued", action, params };

    const config = integration.config as { url?: string; headers?: Record<string, string> };
    if (!config.url) return { status: "error", error: "rest integration has no url" };
    const url = new URL(action.startsWith("/") ? action : `/${action}`, config.url).toString();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(config.headers ?? {}) },
        body: JSON.stringify(params),
      });
      return {
        status: res.ok ? "delivered" : "error",
        httpStatus: res.status,
        body: (await res.text()).slice(0, 500),
      };
    } catch (err) {
      return { status: "error", error: err instanceof Error ? err.message : String(err) };
    }
  });

  registry.register("slack", async (action, params, { organizationId }) => {
    const integration = (
      await ctx.store.integrations.list(
        (i) =>
          i.organizationId === organizationId && i.kind === "slack" && i.status === "connected",
      )
    )[0];
    if (!integration) {
      return { status: "queued", channel: "slack", to: params.to ?? null, text: params.text ?? null };
    }

    const config = integration.config as { webhookUrl?: string };
    if (!config.webhookUrl) return { status: "error", error: "slack integration has no webhookUrl" };
    const text = String(params.text ?? params.message ?? action);
    try {
      const res = await fetch(config.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      return { status: res.ok ? "delivered" : "error", httpStatus: res.status };
    } catch (err) {
      return { status: "error", error: err instanceof Error ? err.message : String(err) };
    }
  });

  return registry;
}
