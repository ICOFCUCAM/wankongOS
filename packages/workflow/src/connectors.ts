import type { IntegrationKind } from "@wankong/core";

export interface ConnectorContext {
  organizationId: string;
  runId: string;
}

/**
 * A connector turns an integration node's (action, params) into a real effect
 * and returns a structured result the workflow can branch on. Handlers are
 * pluggable per integration kind; the API wires production handlers (with
 * credentials) while the defaults below are deterministic and side-effect-free
 * so runs are hermetic in tests and demos.
 */
export type ConnectorHandler = (
  action: string,
  params: Record<string, unknown>,
  ctx: ConnectorContext,
) => Promise<Record<string, unknown>>;

export class ConnectorError extends Error {}

export class ConnectorRegistry {
  private readonly handlers = new Map<IntegrationKind, ConnectorHandler>();

  register(kind: IntegrationKind, handler: ConnectorHandler): this {
    this.handlers.set(kind, handler);
    return this;
  }

  has(kind: IntegrationKind): boolean {
    return this.handlers.has(kind);
  }

  async invoke(
    kind: IntegrationKind,
    action: string,
    params: Record<string, unknown>,
    ctx: ConnectorContext,
  ): Promise<Record<string, unknown>> {
    const handler = this.handlers.get(kind);
    if (!handler) throw new ConnectorError(`No connector registered for "${kind}"`);
    return handler(action, params, ctx);
  }
}

/**
 * Default, hermetic connectors. They record the intended action and return a
 * deterministic result. Swap individual kinds for credentialed handlers in
 * production (e.g. a real Slack/Stripe client) without changing workflows.
 */
export function defaultConnectors(): ConnectorRegistry {
  const registry = new ConnectorRegistry();
  const queued: ConnectorHandler = async (action, params) => ({
    status: "queued",
    action,
    params,
  });
  registry
    .register("email", async (action, params) => ({ status: "queued", channel: "email", ...pick(params, ["to", "subject"]) }))
    .register("slack", async (action, params) => ({ status: "queued", channel: "slack", ...pick(params, ["to", "text"]) }))
    .register("teams", queued)
    .register("whatsapp", queued)
    .register("hubspot", queued)
    .register("salesforce", queued)
    .register("stripe", queued)
    .register("quickbooks", queued)
    .register("github", queued)
    .register("notion", queued)
    .register("rest", queued)
    .register("webhook", async (action, params) => ({ status: "queued", url: params.url ?? null }));
  return registry;
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}
