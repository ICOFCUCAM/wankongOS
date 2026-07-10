import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { UserRole } from "@wankong/core";
import {
  actorFor,
  createAppContext,
  demoActor,
  type AppContext,
  type Env,
} from "./context.js";
import { organizationRoutes } from "./routes/organization.js";
import { employeeRoutes } from "./routes/employees.js";
import { taskRoutes } from "./routes/tasks.js";
import { chatRoutes } from "./routes/chat.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { workflowRoutes } from "./routes/workflows.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { memoryRoutes } from "./routes/memories.js";
import { evalRoutes } from "./routes/evals.js";
import { lifecycleRoutes } from "./routes/lifecycle.js";
import { apiKeyRoutes } from "./routes/apikeys.js";
import { reviewRoutes } from "./routes/reviews.js";
import { integrationRoutes } from "./routes/integrations.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { workerRoutes } from "./routes/worker.js";
import { looksLikeApiKey, resolveApiKey } from "./auth.js";

export interface CreateAppOptions {
  context?: AppContext;
  /** Disable request logging (used in tests). */
  quiet?: boolean;
}

/**
 * Build the API application. Auth here is the dev/demo path: requests act as the
 * organization owner, and an `x-demo-role` header lets you exercise the
 * permission model at any role. The seams (`actorFor`) are where a real SSO /
 * API-key resolver drops in without touching route code.
 */
export function createApp(options: CreateAppOptions = {}): Hono<Env> {
  const context = options.context ?? createAppContext();
  const app = new Hono<Env>();

  if (!options.quiet) app.use("*", logger());
  app.use("*", cors());

  // Context + authentication.
  app.use("*", async (c, next) => {
    // Store init (schema/seed for Postgres) completes before any request runs.
    await context.ready;
    c.set("ctx", context);

    // Machine access: a Bearer API key authenticates with exactly its scopes.
    const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (bearer && looksLikeApiKey(bearer)) {
      const resolved = await resolveApiKey(context.store, context.organizationId, bearer);
      if (!resolved) return c.json({ error: "Invalid or revoked API key" }, 401);
      c.set("actor", {
        user: {
          id: resolved.key.id,
          organizationId: context.organizationId,
          email: "apikey@wankong.local",
          name: `API key: ${resolved.key.name}`,
          role: "member",
          status: "active",
          createdAt: resolved.key.createdAt,
          updatedAt: resolved.key.updatedAt,
        },
        permissions: resolved.permissions,
      });
      return next();
    }

    const owner = (await context.store.users.list((u) => u.role === "owner"))[0];
    const fallback = owner ?? {
      id: "usr_system",
      organizationId: context.organizationId,
      email: "system@wankong.local",
      name: "System",
      role: "owner" as const,
      status: "active" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const roleHeader = c.req.header("x-demo-role");
    const parsedRole = UserRole.safeParse(roleHeader);
    c.set("actor", parsedRole.success ? demoActor(fallback, parsedRole.data) : actorFor(fallback));

    await next();
  });

  app.get("/health", (c) => c.json({ status: "ok", service: "wankong-api" }));

  const v1 = new Hono<Env>();
  v1.route("/", organizationRoutes);
  v1.route("/", employeeRoutes);
  v1.route("/", taskRoutes);
  v1.route("/", chatRoutes);
  v1.route("/", dashboardRoutes);
  v1.route("/", workflowRoutes);
  v1.route("/", knowledgeRoutes);
  v1.route("/", memoryRoutes);
  v1.route("/", evalRoutes);
  v1.route("/", lifecycleRoutes);
  v1.route("/", apiKeyRoutes);
  v1.route("/", reviewRoutes);
  v1.route("/", integrationRoutes);
  v1.route("/", webhookRoutes);
  v1.route("/", workerRoutes);
  app.route("/v1", v1);

  app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json(
        { error: err.message, details: (err.cause as unknown) ?? undefined },
        err.status,
      );
    }
    console.error("Unhandled API error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
