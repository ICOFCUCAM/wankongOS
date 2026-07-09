import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { LocalEmbedder } from "@wankong/knowledge";
import { createApp } from "../src/app.js";
import { createAppContext } from "../src/context.js";

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp({
    context: createAppContext({
      store: createSeededStore(),
      registry: new ProviderRegistry(),
      embedder: new LocalEmbedder(),
      organizationId: SEED_ORG_ID,
    }),
    quiet: true,
  });
});

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

describe("M3c: API keys", () => {
  it("creates a key (plaintext once), authenticates with it, and enforces scopes", async () => {
    const created = await (
      await app.request("/v1/api-keys", json({ name: "Reader", scopes: ["employee:read", "org:read"] }))
    ).json();
    expect(created.key.startsWith("wk_live_")).toBe(true);
    expect(created.prefix.length).toBeLessThan(created.key.length);

    // The key authenticates and can read employees…
    const ok = await app.request("/v1/employees", {
      headers: { authorization: `Bearer ${created.key}` },
    });
    expect(ok.status).toBe(200);

    // …but cannot act beyond its scopes.
    const denied = await app.request(
      "/v1/employees/emp_legal/chat",
      json({ input: "hi" }, { authorization: `Bearer ${created.key}` }),
    );
    expect(denied.status).toBe(403);
  });

  it("rejects unknown and revoked keys with 401", async () => {
    const bad = await app.request("/v1/employees", {
      headers: { authorization: "Bearer wk_live_0000000000000000000000000000000000000000" },
    });
    expect(bad.status).toBe(401);

    const created = await (
      await app.request("/v1/api-keys", json({ name: "Temp", scopes: ["employee:read"] }))
    ).json();
    await app.request(`/v1/api-keys/${created.id}`, { method: "DELETE" });
    const revoked = await app.request("/v1/employees", {
      headers: { authorization: `Bearer ${created.key}` },
    });
    expect(revoked.status).toBe(401);
  });

  it("prevents privilege escalation: cannot grant scopes the creator lacks", async () => {
    const res = await app.request(
      "/v1/api-keys",
      json({ name: "Sneaky", scopes: ["billing:manage"] }, { "x-demo-role": "admin" }),
    );
    expect(res.status).toBe(403);
  });

  it("lists keys without exposing hashes or plaintext", async () => {
    await app.request("/v1/api-keys", json({ name: "K1", scopes: ["org:read"] }));
    const list = await (await app.request("/v1/api-keys")).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].hashedKey).toBeUndefined();
    expect(list.data[0].key).toBeUndefined();
    expect(list.data[0].prefix.startsWith("wk_live_")).toBe(true);
  });
});

describe("M3c: performance reviews", () => {
  it("generates a KPI-backed review from real activity", async () => {
    // Create activity: an eval run and a chat.
    await app.request("/v1/employees/emp_support_manager/evals/run", json({}));
    await app.request("/v1/employees/emp_support_manager/chat", json({ input: "Status update?" }));

    const res = await app.request("/v1/employees/emp_support_manager/reviews", json({}));
    expect(res.status).toBe(201);
    const review = await res.json();
    expect(review.kind).toBe("performance_review");
    expect(review.subjectId).toBe("emp_support_manager");
    expect(review.metrics.evalPassRate).toBe(1);
    expect(review.metrics.conversations).toBeGreaterThanOrEqual(1);
    expect(review.narrative).toContain("100% eval pass rate");
    expect(review.narrative).toContain("exceeding");

    const list = await (await app.request("/v1/employees/emp_support_manager/reviews")).json();
    expect(list.data).toHaveLength(1);
  });

  it("flags employees with failing evals as needing attention", async () => {
    // Give the analyst a suite it can't pass, run it, then review.
    const ctx = createAppContext({
      store: createSeededStore(),
      registry: new ProviderRegistry(),
      embedder: new LocalEmbedder(),
      organizationId: SEED_ORG_ID,
    });
    const localApp = createApp({ context: ctx, quiet: true });
    ctx.store.evalSuites.insert({
      id: "evs_hard",
      organizationId: SEED_ORG_ID,
      employeeId: "emp_research",
      name: "Impossible",
      tasks: [
        {
          id: "t",
          name: "t",
          input: "Say hello.",
          checks: [{ kind: "contains", value: "xyzzy-nope", caseSensitive: false }],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await localApp.request("/v1/employees/emp_research/evals/run", json({}));
    const review = await (
      await localApp.request("/v1/employees/emp_research/reviews", json({}))
    ).json();
    expect(review.metrics.evalPassRate).toBe(0);
    expect(review.narrative).toContain("needs attention");
  });

  it("requires employee:manage to generate a review", async () => {
    const res = await app.request(
      "/v1/employees/emp_legal/reviews",
      json({}, { "x-demo-role": "viewer" }),
    );
    expect(res.status).toBe(403);
  });
});
