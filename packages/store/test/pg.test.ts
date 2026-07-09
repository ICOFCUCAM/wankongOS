import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  ensurePgSchema,
  NotFoundError,
  PgStore,
  SEED_ORG_ID,
  seedStoreAsync,
  type SqlClient,
} from "@wankong/store";

/**
 * PGlite (in-process WASM Postgres) adapter: the PgStore runs on REAL SQL in
 * CI with zero infrastructure — the same code path production uses against
 * Supabase/Neon/RDS via postgres.js.
 */
function pgliteClient(db: PGlite): SqlClient {
  return {
    async query(sql, params = []) {
      const res = await db.query(sql, params as unknown[]);
      return { rows: res.rows as Record<string, unknown>[] };
    },
    async close() {
      await db.close();
    },
  };
}

let db: PGlite;
let client: SqlClient;
let store: PgStore;

beforeAll(async () => {
  db = new PGlite();
  client = pgliteClient(db);
  await ensurePgSchema(client);
  store = new PgStore(client);
  await seedStoreAsync(store);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("PgStore on real SQL (PGlite)", () => {
  it("seeds the demo organization durably", async () => {
    expect(await store.employees.count()).toBe(11);
    expect((await store.organizations.get(SEED_ORG_ID))?.name).toBe("Acme Robotics");
    expect(await store.documents.count()).toBe(3);
    expect(await store.evalSuites.count()).toBe(2);
  });

  it("seeding is idempotent (fixed ids upsert)", async () => {
    await seedStoreAsync(store);
    expect(await store.employees.count()).toBe(11);
  });

  it("supports CRUD round-trips with prefixed ids", async () => {
    const task = await store.tasks.create({
      organizationId: SEED_ORG_ID,
      title: "SQL task",
      description: "",
      status: "todo",
      priority: "high",
      createdBy: { kind: "user", id: "usr_ceo" },
      labels: ["sql"],
    });
    expect(task.id.startsWith("task_")).toBe(true);

    const fetched = await store.tasks.get(task.id);
    expect(fetched?.title).toBe("SQL task");
    expect(fetched?.labels).toEqual(["sql"]);

    const updated = await store.tasks.update(task.id, { status: "done" });
    expect(updated.status).toBe("done");

    expect(await store.tasks.delete(task.id)).toBe(true);
    expect(await store.tasks.get(task.id)).toBeNull();
    expect(await store.tasks.delete(task.id)).toBe(false);
  });

  it("throws NotFoundError on updating a missing row", async () => {
    await expect(store.employees.update("emp_missing", { name: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("filters with predicates and counts", async () => {
    const sales = await store.employees.list((e) => e.departmentId === "dept_sales");
    expect(sales.map((e) => e.id)).toContain("emp_sales_director");
    expect(await store.employees.count((e) => e.status === "active")).toBe(11);
  });

  it("shared BaseStore helpers work over SQL: org chart reaches all 11", async () => {
    const chart = await store.orgChart(SEED_ORG_ID);
    const count = (nodes: Awaited<ReturnType<typeof store.orgChart>>): number =>
      nodes.reduce((n, node) => n + 1 + count(node.reports), 0);
    expect(count(chart)).toBe(11);
  });

  it("persists JSONB faithfully: nested employee config survives round-trip", async () => {
    const employee = await store.employees.get("emp_support_manager");
    expect(employee?.kpis[0]?.direction).toBe("higher_is_better");
    expect(employee?.approvalRules[0]?.requires).toBe("task:approve");
    expect(employee?.availability.alwaysOn).toBe(true);
  });
});
