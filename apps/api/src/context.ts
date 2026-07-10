import { EmployeeRuntime, ProviderRegistry } from "@wankong/agents";
import { embedderFromEnv, type Embedder } from "@wankong/knowledge";
import {
  createPostgresClient,
  createSeededStore,
  ensurePgSchema,
  PgStore,
  SEED_ORG_ID,
  seedStoreAsync,
  type Store,
} from "@wankong/store";
import type { Permission, User, UserRole } from "@wankong/core";
import { newId, permissionsForRole } from "@wankong/core";
import {
  WorkflowEngine,
  buildSeedWorkflow,
  defaultConnectors,
} from "@wankong/workflow";
import { buildEmployeePromptContext } from "./employee-context.js";
import { buildToolRegistry } from "./tools.js";
import { applyCredentialedConnectors } from "./connectors.js";

/** The authenticated actor for a request. */
export interface Actor {
  user: User;
  permissions: Set<Permission>;
}

/** Everything a route handler needs, assembled once at boot. */
export interface AppContext {
  /** Do not touch before `ready` resolves — the app middleware awaits it. */
  store: Store;
  registry: ProviderRegistry;
  runtime: EmployeeRuntime;
  workflowEngine: WorkflowEngine;
  embedder: Embedder;
  /** Built-in executable tools, permission-gated per employee. */
  toolRegistry: import("@wankong/agents").ToolRegistry;
  /** The organization this API instance serves (single-tenant per instance). */
  organizationId: string;
  /** Resolves once the store is initialised (schema ensured, seeded if empty). */
  ready: Promise<void>;
}

export interface AppContextOptions {
  store?: Store;
  registry?: ProviderRegistry;
  organizationId?: string;
  embedder?: Embedder;
  /** Postgres connection string; defaults to env DATABASE_URL. */
  databaseUrl?: string;
}

/**
 * Build the application context.
 *
 * Store selection: an explicitly-passed store wins; otherwise a configured
 * DATABASE_URL selects the durable Postgres store (schema ensured and demo org
 * seeded on first boot); otherwise the seeded in-memory store. Postgres setup
 * is asynchronous, so the store is initialised behind `ready`, which the app
 * middleware awaits before serving any request.
 */
export function createAppContext(options: AppContextOptions = {}): AppContext {
  const registry = options.registry ?? ProviderRegistry.fromEnv();
  const runtime = new EmployeeRuntime(registry);
  const organizationId = options.organizationId ?? SEED_ORG_ID;
  const embedder = options.embedder ?? embedderFromEnv();
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;

  const context: AppContext = {
    store: undefined as unknown as Store,
    registry,
    runtime,
    workflowEngine: undefined as unknown as WorkflowEngine,
    embedder,
    toolRegistry: undefined as unknown as import("@wankong/agents").ToolRegistry,
    organizationId,
    ready: Promise.resolve(),
  };

  context.ready = (async () => {
    if (options.store) {
      context.store = options.store;
    } else if (databaseUrl) {
      const client = await createPostgresClient(databaseUrl);
      await ensurePgSchema(client);
      const pg = new PgStore(client);
      if ((await pg.organizations.count()) === 0) await seedStoreAsync(pg);
      context.store = pg;
    } else {
      context.store = createSeededStore();
    }
    // Seed the demo workflow (kept out of @wankong/store so the store carries
    // no AI dependency). Fixed id → idempotent upsert on every boot.
    await context.store.workflows.insert(buildSeedWorkflow(organizationId));
    context.toolRegistry = buildToolRegistry(context.store, organizationId, embedder, runtime);
  })();

  context.workflowEngine = new WorkflowEngine({
    runtime,
    connectors: applyCredentialedConnectors(defaultConnectors(), context),
    resolveEmployee: async (id) => {
      const employee = await context.store.employees.get(id);
      if (!employee || employee.organizationId !== organizationId) return null;
      // Paused/training employees don't take on workflow steps (kill switch,
      // probation): the step fails visibly rather than silently proceeding.
      if (employee.status !== "active") return null;
      return {
        employee,
        context: await buildEmployeePromptContext(context.store, organizationId, employee),
      };
    },
    createApproval: async ({ summary, requiredPermission, runId, nodeId }) => {
      const approval = await context.store.approvals.create({
        organizationId,
        requestedBy: { kind: "employee", id: "workflow" },
        summary,
        requiredPermission,
        status: "pending",
      });
      await context.store.audit({
        organizationId,
        actor: { kind: "user", id: "system" },
        action: "workflow.approval.requested",
        targetType: "workflow_run",
        targetId: runId,
        metadata: { approvalId: approval.id, nodeId },
      });
      return approval.id;
    },
    emitNotification: async ({ channel, message, to, runId }) => {
      await context.store.audit({
        organizationId,
        actor: { kind: "user", id: "system" },
        action: "notification.emit",
        targetType: "workflow_run",
        targetId: runId,
        metadata: { channel, message, to: to ?? null },
      });
    },
  });

  return context;
}

/** Generate a fresh workflow-run id. */
export function newWorkflowRunId(): string {
  return newId("workflowRun");
}

/** Bindings shared across all Hono handlers. */
export type Env = {
  Variables: {
    ctx: AppContext;
    actor: Actor;
  };
};

/** Construct an actor for a resolved user. */
export function actorFor(user: User): Actor {
  return { user, permissions: new Set<Permission>(permissionsForRole(user.role)) };
}

/** A synthetic actor with an explicit role (used for the demo/dev auth path). */
export function demoActor(user: User, role: UserRole): Actor {
  return { user: { ...user, role }, permissions: new Set(permissionsForRole(role)) };
}
