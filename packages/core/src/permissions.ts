import type { Permission, UserRole } from "./enums.js";

/**
 * Role → permission expansion. Every sensitive action is gated on a single
 * `Permission`; roles are just named bundles. Keeping the mapping here (rather
 * than sprinkling role checks through the code) is what makes access control
 * auditable and lets us evolve roles without touching call sites.
 */
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner: [
    "org:read",
    "org:manage",
    "member:invite",
    "member:manage",
    "employee:read",
    "employee:create",
    "employee:manage",
    "employee:chat",
    "task:read",
    "task:create",
    "task:assign",
    "task:approve",
    "workflow:read",
    "workflow:manage",
    "workflow:run",
    "knowledge:read",
    "knowledge:write",
    "integration:read",
    "integration:manage",
    "billing:read",
    "billing:manage",
    "audit:read",
    "apikey:manage",
  ],
  admin: [
    "org:read",
    "org:manage",
    "member:invite",
    "member:manage",
    "employee:read",
    "employee:create",
    "employee:manage",
    "employee:chat",
    "task:read",
    "task:create",
    "task:assign",
    "task:approve",
    "workflow:read",
    "workflow:manage",
    "workflow:run",
    "knowledge:read",
    "knowledge:write",
    "integration:read",
    "integration:manage",
    "audit:read",
    "apikey:manage",
  ],
  manager: [
    "org:read",
    "employee:read",
    "employee:create",
    "employee:manage",
    "employee:chat",
    "task:read",
    "task:create",
    "task:assign",
    "task:approve",
    "workflow:read",
    "workflow:run",
    "knowledge:read",
    "knowledge:write",
    "integration:read",
  ],
  member: [
    "org:read",
    "employee:read",
    "employee:chat",
    "task:read",
    "task:create",
    "workflow:read",
    "workflow:run",
    "knowledge:read",
    "knowledge:write",
  ],
  viewer: ["org:read", "employee:read", "task:read", "workflow:read", "knowledge:read"],
};

/** All permissions granted by a role. */
export function permissionsForRole(role: UserRole): ReadonlySet<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

/** Does a role grant a specific permission? */
export function roleCan(role: UserRole, permission: Permission): boolean {
  return permissionsForRole(role).has(permission);
}

/** Does an explicit permission set grant a specific permission? */
export function can(granted: Iterable<Permission>, permission: Permission): boolean {
  for (const p of granted) if (p === permission) return true;
  return false;
}

/** Thrown when an actor lacks a required permission. */
export class PermissionError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Missing required permission: ${permission}`);
    this.name = "PermissionError";
  }
}

/** Assert a permission, throwing `PermissionError` when absent. */
export function requirePermission(granted: Iterable<Permission>, permission: Permission): void {
  if (!can(granted, permission)) throw new PermissionError(permission);
}
