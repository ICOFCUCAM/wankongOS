import { Hono } from "hono";
import { CompanyDna, CompanyPolicy, findPolicies } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize, parseBody } from "../http.js";

export const dnaRoutes = new Hono<Env>();

/** The org's DNA, creating a blank record on first read. */
export async function dnaOf(ctx: Env["Variables"]["ctx"]) {
  const existing = (await ctx.store.companyDnas.listByOrg(ctx.organizationId))[0];
  if (existing) return existing;
  return ctx.store.companyDnas.create(
    CompanyDna.omit({ id: true, createdAt: true, updatedAt: true }).parse({
      organizationId: ctx.organizationId,
    }),
  );
}

dnaRoutes.get("/dna", async (c) => {
  authorize(c, "org:read");
  return c.json(await dnaOf(c.get("ctx")));
});

const DnaPatch = CompanyDna.omit({ id: true, createdAt: true, updatedAt: true, organizationId: true }).partial();

dnaRoutes.put("/dna", async (c) => {
  authorize(c, "org:manage");
  const ctx = c.get("ctx");
  const patch = await parseBody(c, DnaPatch);
  const dna = await dnaOf(ctx);
  const updated = await ctx.store.companyDnas.update(dna.id, patch);
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "dna.update",
    targetType: "companyDna",
    targetId: dna.id,
    metadata: { fields: Object.keys(patch) },
  });
  return c.json(updated);
});

/** Policy Engine: add or replace a policy (matched by policy id, version bumps). */
dnaRoutes.put("/dna/policies/:policyId", async (c) => {
  authorize(c, "org:manage");
  const ctx = c.get("ctx");
  const input = await parseBody(c, CompanyPolicy.omit({ id: true, version: true }));
  const dna = await dnaOf(ctx);
  const policyId = c.req.param("policyId");
  const existing = dna.policies.find((p) => p.id === policyId);
  const policy = { ...input, id: policyId, version: (existing?.version ?? 0) + 1 };
  const policies = existing
    ? dna.policies.map((p) => (p.id === policyId ? policy : p))
    : [...dna.policies, policy];
  const updated = await ctx.store.companyDnas.update(dna.id, { policies });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: existing ? "dna.policy.update" : "dna.policy.create",
    targetType: "companyDna",
    targetId: dna.id,
    metadata: { policyId, name: policy.name, version: policy.version },
  });
  return c.json(updated);
});

/** Policy Engine lookup — what employees query instead of prompt text. */
dnaRoutes.get("/dna/policies", async (c) => {
  authorize(c, "org:read");
  const dna = await dnaOf(c.get("ctx"));
  const q = c.req.query("q");
  const data = q ? findPolicies(dna, q) : dna.policies;
  return c.json({ data, note: "Policies live in Company DNA — updating one updates every employee at once." });
});
