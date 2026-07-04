import { describe, expect, it } from "vitest";
import { MemoryStore, NotFoundError } from "@wankong/store";

const fixedClock = () => "2026-02-02T00:00:00.000Z";

describe("MemoryRepository", () => {
  it("creates entities with generated prefixed ids and timestamps", async () => {
    const store = new MemoryStore(fixedClock);
    const org = await store.organizations.create({
      name: "Test Co",
      slug: "test-co",
      plan: "trial",
      settings: { defaultProvider: "local", dataResidency: "global" },
    });
    expect(org.id.startsWith("org_")).toBe(true);
    expect(org.createdAt).toBe("2026-02-02T00:00:00.000Z");
    expect(await store.organizations.get(org.id)).toEqual(org);
  });

  it("updates and bumps updatedAt, and deletes", async () => {
    const store = new MemoryStore(fixedClock);
    const org = await store.organizations.create({
      name: "A",
      slug: "a",
      plan: "trial",
      settings: { defaultProvider: "local", dataResidency: "global" },
    });
    const updated = await store.organizations.update(org.id, { name: "B" });
    expect(updated.name).toBe("B");
    expect(await store.organizations.delete(org.id)).toBe(true);
    expect(await store.organizations.get(org.id)).toBeNull();
  });

  it("throws NotFoundError when updating a missing entity", async () => {
    const store = new MemoryStore(fixedClock);
    await expect(store.employees.update("emp_missing", { name: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("filters with list and counts", async () => {
    const store = new MemoryStore(fixedClock);
    await store.tasks.create({
      organizationId: "org_1",
      title: "T1",
      description: "",
      status: "todo",
      priority: "normal",
      createdBy: { kind: "user", id: "usr_1" },
      labels: [],
    });
    await store.tasks.create({
      organizationId: "org_2",
      title: "T2",
      description: "",
      status: "done",
      priority: "low",
      createdBy: { kind: "user", id: "usr_1" },
      labels: [],
    });
    expect(await store.tasks.count()).toBe(2);
    expect(await store.tasks.count((t) => t.organizationId === "org_1")).toBe(1);
    expect((await store.tasks.list((t) => t.status === "done"))[0]!.title).toBe("T2");
  });
});
