import { EmployeeRuntime, ProviderRegistry } from "@wankong/agents";
import {
  createSeededStore,
  MemoryStore,
  SEED_ORG_ID,
} from "@wankong/store";
import type { Permission, User, UserRole } from "@wankong/core";
import { permissionsForRole } from "@wankong/core";

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
  /** The organization this API instance serves (single-tenant per instance). */
  organizationId: string;
}

export interface AppContextOptions {
  store?: MemoryStore;
  registry?: ProviderRegistry;
  organizationId?: string;
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
  return {
    store,
    registry,
    runtime: new EmployeeRuntime(registry),
    organizationId: options.organizationId ?? SEED_ORG_ID,
  };
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
