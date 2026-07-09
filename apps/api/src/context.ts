import { EmployeeRuntime, ProviderRegistry } from "@wankong/agents";
import { embedderFromEnv, type Embedder } from "@wankong/knowledge";
import {
  createSeededStore,
  MemoryStore,
  SEED_ORG_ID,
} from "@wankong/store";
import type { Permission, User, UserRole } from "@wankong/core";
import { newId, permissionsForRole } from "@wankong/core";
import {
  WorkflowEngine,
  buildSeedWorkflow,
  defaultConnectors,
} from "@wankong/workflow";
import { buildEmployeePromptContext } from "./employee-context.js";

/** The authenticated actor for a request. */
export interface Actor {
  user: User;
  permissions: Set<Permission>;
}

/** Everything a route handler needs, assembled once at boot. */
export interface AppContext {
  store: MemoryStore;
  registry: ProviderRegistry;
  runtime: EmployeeRuntime;
  workflowEngine: WorkflowEngine;
  embedder: Embedder;
  /** The organization this API instance serves (single-tenant per instance). */
  organizationId: string;
}

export interface AppContextOptions {
  store?: MemoryStore;
  registry?: ProviderRegistry;
  organizationId?: string;
  embedder?: Embedder;
}

/**
 * Build the application context. By default it comes pre-loaded with the demo
 * organization and a provider registry configured from the environment, so the
 * API is fully functional out of the box — with real cloud models when keys are
 * present, and the local provider otherwise.
 */
export function createAppContext(options: AppContextOptions = {}): AppContext {
  const store = options.store ?? createSeededStore();
  const registry = options.registry ?? ProviderRegistry.fromEnv();
  const runtime = new EmployeeRuntime(registry);
  const organizationId = options.organizationId ?? SEED_ORG_ID;
  const embedder = options.embedder ?? embedderFromEnv();

  // Seed the demo workflow here (kept out of @wankong/store so the store carries
  // no AI dependency; the API is the layer that composes store + engine).
  store.workflows.insert(buildSeedWorkflow(organizationId));

  const workflowEngine = new WorkflowEngine({
    runtime,
    connectors: defaultConnectors(),
    resolveEmployee: async (id) => {
      const employee = await store.employees.get(id);
      if (!employee || employee.organizationId !== organizationId) return null;
      return { employee, context: await buildEmployeePromptContext(store, organizationId, employee) };
    },
    createApproval: async ({ summary, requiredPermission, runId, nodeId }) => {
      const approval = await store.approvals.create({
        organizationId,
        requestedBy: { kind: "employee", id: "workflow" },
        summary,
        requiredPermission,
        status: "pending",
      });
      await store.audit({
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
      await store.audit({
        organizationId,
        actor: { kind: "user", id: "system" },
        action: "notification.emit",
        targetType: "workflow_run",
        targetId: runId,
        metadata: { channel, message, to: to ?? null },
      });
    },
  });

  return { store, registry, runtime, workflowEngine, embedder, organizationId };
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
