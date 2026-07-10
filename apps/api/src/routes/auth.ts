import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context.js";
import { parseBody } from "../http.js";
import { hashPassword, signSession, verifyPassword } from "../auth-session.js";

const Register = z.object({
  organizationName: z.string().min(2).max(120),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(10).max(200),
});
const Login = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

const WEEK = 7 * 24 * 3600;
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "org";

export const authRoutes = new Hono<Env>();

/** Create a NEW organization with its owner — the real-tenant entry point. */
authRoutes.post("/auth/register", async (c) => {
  const ctx = c.get("ctx");
  const input = await parseBody(c, Register);
  const existing = await ctx.store.users.list((u) => u.email === input.email);
  if (existing.length > 0) return c.json({ error: "An account with this email already exists." }, 409);

  let slug = slugify(input.organizationName);
  if ((await ctx.store.organizations.list((o) => o.slug === slug)).length > 0) {
    slug = `${slug}-${Math.abs(Date.now() % 10_000)}`;
  }
  const org = await ctx.store.organizations.create({
    name: input.organizationName,
    slug,
    plan: "trial",
    settings: { defaultProvider: "local", dataResidency: "global", jurisdiction: "US" },
  });
  const user = await ctx.store.users.create({
    organizationId: org.id,
    email: input.email,
    name: input.name,
    role: "owner",
    status: "active",
    passwordHash: hashPassword(input.password),
  });
  await ctx.store.audit({
    organizationId: org.id,
    actor: { kind: "user", id: user.id },
    action: "auth.register",
    targetType: "organization",
    targetId: org.id,
    metadata: { slug },
  });
  const token = signSession({ userId: user.id, organizationId: org.id, exp: Math.floor(Date.now() / 1000) + WEEK });
  return c.json({ token, organization: org, user: { id: user.id, email: user.email, name: user.name, role: user.role } }, 201);
});

authRoutes.post("/auth/login", async (c) => {
  const ctx = c.get("ctx");
  const input = await parseBody(c, Login);
  const user = (await ctx.store.users.list((u) => u.email === input.email))[0];
  if (!user?.passwordHash || !verifyPassword(input.password, user.passwordHash) || user.status !== "active") {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  const token = signSession({ userId: user.id, organizationId: user.organizationId, exp: Math.floor(Date.now() / 1000) + WEEK });
  return c.json({ token, organizationId: user.organizationId, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

authRoutes.get("/auth/me", (c) => {
  const actor = c.get("actor");
  const ctx = c.get("ctx");
  const { passwordHash: _p, ...user } = actor.user as typeof actor.user & { passwordHash?: string };
  return c.json({ user, organizationId: ctx.organizationId, permissions: actor.permissions ?? null });
});
