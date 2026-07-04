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
    c.set("ctx", context);

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
