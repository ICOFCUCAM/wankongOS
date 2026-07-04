import { describe, expect, it } from "vitest";
import {
  PermissionError,
  permissionsForRole,
  requirePermission,
  roleCan,
} from "@wankong/core";

describe("permissions", () => {
  it("grants owners full control including billing", () => {
    expect(roleCan("owner", "billing:manage")).toBe(true);
    expect(roleCan("owner", "employee:create")).toBe(true);
  });

  it("withholds billing from admins but keeps org management", () => {
    expect(roleCan("admin", "billing:manage")).toBe(false);
    expect(roleCan("admin", "org:manage")).toBe(true);
  });

  it("restricts viewers to read-only", () => {
    const perms = permissionsForRole("viewer");
    for (const p of perms) expect(p.endsWith(":read")).toBe(true);
    expect(roleCan("viewer", "employee:chat")).toBe(false);
  });

  it("lets members chat and create tasks but not approve them", () => {
    expect(roleCan("member", "employee:chat")).toBe(true);
    expect(roleCan("member", "task:create")).toBe(true);
    expect(roleCan("member", "task:approve")).toBe(false);
  });

  it("requirePermission throws a typed error when absent", () => {
    expect(() => requirePermission(permissionsForRole("viewer"), "employee:chat")).toThrow(
      PermissionError,
    );
    expect(() =>
      requirePermission(permissionsForRole("manager"), "employee:chat"),
    ).not.toThrow();
  });
});
