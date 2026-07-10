import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { createApp } from "../src/app.js";
import { createAppContext } from "../src/context.js";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp({
    context: createAppContext({ store: createSeededStore(), registry: new ProviderRegistry(), organizationId: SEED_ORG_ID }),
    quiet: true,
  });
});
const json = (body: unknown) => ({
  method: "POST" as const,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe("real identity and tenant isolation (ADR-0025)", () => {
  it("registers a new organization, logs in, and sees only its own world", async () => {
    const reg = await app.request("/v1/auth/register", json({
      organizationName: "Nordlys Consulting",
      name: "Ingrid Berg",
      email: "ingrid@nordlys.no",
      password: "correct-horse-battery",
    }));
    expect(reg.status).toBe(201);
    const { token, organization } = await reg.json();
    expect(token.startsWith("wks_")).toBe(true);
    expect(organization.slug).toBe("nordlys-consulting");

    // The new tenant is EMPTY — no bleed from the seeded demo org.
    const employees = await (await app.request("/v1/employees", auth(token))).json();
    expect(employees.data).toHaveLength(0);
    const me = await (await app.request("/v1/auth/me", auth(token))).json();
    expect(me.user.email).toBe("ingrid@nordlys.no");
    expect(me.organizationId).toBe(organization.id);

    const login = await app.request("/v1/auth/login", json({ email: "ingrid@nordlys.no", password: "correct-horse-battery" }));
    expect(login.status).toBe(200);
    const bad = await app.request("/v1/auth/login", json({ email: "ingrid@nordlys.no", password: "wrong" }));
    expect(bad.status).toBe(401);
  });

  it("two tenants cannot see each other's records", async () => {
    const a = await (await app.request("/v1/auth/register", json({ organizationName: "Alpha AS", name: "A", email: "a@alpha.no", password: "alpha-password-1" }))).json();
    const b = await (await app.request("/v1/auth/register", json({ organizationName: "Beta Ltd", name: "B", email: "b@beta.uk", password: "beta-password-22" }))).json();

    const hire = await app.request("/v1/employees", {
      ...json({ departmentId: "dept_x", name: "Alpha Bot", title: "Analyst", description: "d", systemPrompt: "p" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${a.token}` },
    });
    expect(hire.status).toBe(201);
    const created = await hire.json();

    const alphaSees = await (await app.request("/v1/employees", auth(a.token))).json();
    expect(alphaSees.data).toHaveLength(1);
    const betaSees = await (await app.request("/v1/employees", auth(b.token))).json();
    expect(betaSees.data).toHaveLength(0);
    // Direct fetch across tenants 404s (scoped lookup).
    const cross = await app.request(`/v1/employees/${created.id}`, auth(b.token));
    expect(cross.status).toBe(404);
  });

  it("rejects duplicate emails and forged tokens", async () => {
    await app.request("/v1/auth/register", json({ organizationName: "One", name: "N", email: "n@one.com", password: "password-of-ten+" }));
    const dup = await app.request("/v1/auth/register", json({ organizationName: "Two", name: "N", email: "n@one.com", password: "password-of-ten+" }));
    expect(dup.status).toBe(409);
    const forged = await app.request("/v1/employees", auth("wks_forged.token"));
    expect(forged.status).toBe(401);
  });
});

describe("onboarding: the starter pack", () => {
  it("a new org can sign up already staffed — three probation hires with eval gates", async () => {
    const reg = await (await app.request("/v1/auth/register", json({
      organizationName: "Fjord Studio", name: "Kari", email: "kari@fjord.no",
      password: "long-enough-pass", starterPack: true,
    }))).json();
    expect(reg.starterHires).toBe(3); // exactly the trial plan's limit

    const employees = await (await app.request("/v1/employees", auth(reg.token))).json();
    expect(employees.data).toHaveLength(3);
    expect(employees.data.every((e: { status: string }) => e.status === "training")).toBe(true);

    // The fourth hire hits the trial limit — plan enforcement holds at signup too.
    const overflow = await app.request("/v1/marketplace/hire", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${reg.token}` },
      body: JSON.stringify({ templateId: "sdr", name: "Fourth" }),
    });
    expect(overflow.status).toBe(402);
  });
});

describe("session revocation", () => {
  it("logout-all invalidates every outstanding token", async () => {
    const reg = await (await app.request("/v1/auth/register", json({
      organizationName: "Revoke Co", name: "R", email: "r@revoke.io", password: "password-of-ten+",
    }))).json();
    expect((await app.request("/v1/auth/me", auth(reg.token))).status).toBe(200);

    await app.request("/v1/auth/logout-all", { method: "POST", ...auth(reg.token) });
    const dead = await app.request("/v1/employees", auth(reg.token));
    expect(dead.status).toBe(401);

    const relog = await (await app.request("/v1/auth/login", json({ email: "r@revoke.io", password: "password-of-ten+" }))).json();
    expect((await app.request("/v1/auth/me", auth(relog.token))).status).toBe(200);
  });
});

describe("cookie sessions (browser console)", () => {
  it("accepts the wks_ token from the wk_session cookie", async () => {
    const reg = await (await app.request("/v1/auth/register", json({
      organizationName: "Cookie Co", name: "C", email: "c@cookie.io", password: "password-of-ten+",
    }))).json();
    const res = await app.request("/v1/auth/me", { headers: { cookie: `other=1; wk_session=${reg.token}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe("c@cookie.io");
    const bad = await app.request("/v1/employees", { headers: { cookie: "wk_session=wks_forged.x" } });
    expect(bad.status).toBe(401);
  });
});
