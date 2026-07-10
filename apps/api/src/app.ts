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
import { analyticsRoutes } from "./routes/analytics.js";
import { complianceRoutes } from "./routes/compliance.js";
import { summaryRoutes } from "./routes/summaries.js";
import { pulseRoutes } from "./routes/pulse.js";
import { workforceHealthRoutes } from "./routes/workforce-health.js";
import { briefingRoutes } from "./routes/briefing.js";
import { studioRoutes } from "./routes/studios.js";
import { accountingRoutes } from "./routes/accounting.js";
import { recruitingRoutes } from "./routes/recruiting.js";
import { authRoutes } from "./routes/auth.js";
import { notificationRoutes } from "./routes/notifications.js";
import { streamRoutes } from "./routes/stream.js";
import { billingRoutes } from "./routes/billing.js";
import { marketplaceRoutes } from "./routes/marketplace.js";
import { adminRoutes } from "./routes/admin.js";
import { timelineRoutes } from "./routes/timeline.js";
import { meetingRoutes } from "./routes/meetings.js";
import { intelligenceRoutes } from "./routes/intelligence.js";
import { accountingExportRoutes } from "./routes/accounting-exports.js";
import { collaborationRoutes } from "./routes/collaboration.js";
import { searchRoutes } from "./routes/search.js";
import { looksLikeApiKey, resolveApiKey } from "./auth.js";
import { rateLimit, type RateLimitOptions } from "./ratelimit.js";

export interface CreateAppOptions {
  context?: AppContext;
  /** Disable request logging (used in tests). */
  quiet?: boolean;
  /** Override rate limits (tests, high-traffic deployments). */
  rateLimit?: RateLimitOptions;
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
          tokenVersion: 0,
          createdAt: resolved.key.createdAt,
          updatedAt: resolved.key.updatedAt,
        },
        permissions: resolved.permissions,
      });
      return next();
    }

    // Human sessions: a signed wks_ token pins BOTH the user and the tenant —
    // via Authorization header (API clients) or the wk_session cookie
    // (browser console). Same token, same verification.
    const cookieToken = c.req
      .header("cookie")
      ?.split(/;\s*/)
      .find((p) => p.startsWith("wk_session="))
      ?.slice("wk_session=".length);
    const sessionToken = bearer?.startsWith("wks_") ? bearer : cookieToken;
    if (sessionToken?.startsWith("wks_")) {
      const { verifySession } = await import("./auth-session.js");
      const claims = verifySession(sessionToken);
      if (!claims) return c.json({ error: "Invalid or expired session" }, 401);
      const user = await context.store.users.get(claims.userId);
      if (
        !user ||
        user.status !== "active" ||
        user.organizationId !== claims.organizationId ||
        user.tokenVersion !== claims.v
      ) {
        return c.json({ error: "Invalid or expired session" }, 401);
      }
      c.set("ctx", { ...context, organizationId: claims.organizationId });
      c.set("actor", actorFor(user));
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
      tokenVersion: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const roleHeader = c.req.header("x-demo-role");
    const parsedRole = UserRole.safeParse(roleHeader);
    c.set("actor", parsedRole.success ? demoActor(fallback, parsedRole.data) : actorFor(fallback));

    await next();
  });

  // Rate limiting runs after auth so limits are per authenticated actor.
  app.use("/v1/*", rateLimit(options.rateLimit));

  app.get("/health", (c) => c.json({ status: "ok", service: "wankong-api" }));

  const v1 = new Hono<Env>();
  v1.route("/", authRoutes);
  v1.route("/", organizationRoutes);
  // Before employeeRoutes: /employees/summaries must beat /employees/:id.
  v1.route("/", summaryRoutes);
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
  v1.route("/", analyticsRoutes);
  v1.route("/", complianceRoutes);
  v1.route("/", pulseRoutes);
  v1.route("/", workforceHealthRoutes);
  v1.route("/", briefingRoutes);
  v1.route("/", studioRoutes);
  v1.route("/", accountingRoutes);
  v1.route("/", recruitingRoutes);
  v1.route("/", notificationRoutes);
  v1.route("/", streamRoutes);
  v1.route("/", billingRoutes);
  v1.route("/", marketplaceRoutes);
  v1.route("/", adminRoutes);
  v1.route("/", timelineRoutes);
  v1.route("/", meetingRoutes);
  v1.route("/", intelligenceRoutes);
  v1.route("/", accountingExportRoutes);
  v1.route("/", collaborationRoutes);
  v1.route("/", searchRoutes);
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
