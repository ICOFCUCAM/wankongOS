import { Hono } from "hono";
import { z } from "zod";
import { Permission, ROLE_TEMPLATES, templateById } from "@wankong/core";
import type { Env } from "../context.js";
import { authorize, parseBody } from "../http.js";

export const marketplaceRoutes = new Hono<Env>();

marketplaceRoutes.get("/marketplace/templates", (c) => {
  authorize(c, "employee:read");
  return c.json({ data: ROLE_TEMPLATES.map(({ starterEvals, ...t }) => ({ ...t, evalTasks: starterEvals.length })) });
});

/**
 * Hire from a template: employee on probation + the template's starter eval
 * suite, so the eval-gated activation path works from minute one. Plan
 * limits apply exactly as with manual hiring.
 */
marketplaceRoutes.post("/marketplace/hire", async (c) => {
  authorize(c, "employee:create");
  const ctx = c.get("ctx");
  const input = await parseBody(c, z.object({
    templateId: z.string(),
    name: z.string().min(1).max(160),
    departmentId: z.string().max(80).optional(),
  }));
  const template = templateById(input.templateId);
  if (!template) return c.json({ error: `Unknown template "${input.templateId}"` }, 404);
  const { assertWithinPlan } = await import("../plan-limits.js");
  const limit = await assertWithinPlan(ctx, 1);
  if (limit) return c.json({ error: limit }, 402);

  let departmentId = input.departmentId;
  if (!departmentId) {
    const slug = `${template.category.toLowerCase()}-marketplace`;
    const existing = (await ctx.store.departments.listByOrg(ctx.organizationId, (d) => d.slug === slug))[0];
    departmentId = (existing ?? (await ctx.store.departments.create({
      organizationId: ctx.organizationId,
      kind: "operations",
      name: template.category,
      slug,
      description: `${template.category} roles hired from the marketplace.`,
    }))).id;
  }

  const employee = await ctx.store.employees.create({
    organizationId: ctx.organizationId,
    departmentId,
    name: input.name,
    title: template.title,
    status: "training",
    description: template.description,
    systemPrompt: template.systemPrompt,
    responsibilities: template.responsibilities,
    permissions: template.permissions.map((p) => Permission.parse(p)),
    toolIds: template.toolIds,
    personality: template.personality,
    objectives: [],
    kpis: [],
    temperature: 0.3,
    knowledgeBaseIds: [],
    escalationRules: [],
    approvalRules: [],
    availability: { timezone: "UTC", alwaysOn: true },
  });
  await ctx.store.evalSuites.create({
    organizationId: ctx.organizationId,
    employeeId: employee.id,
    name: `${template.title} starter suite`,
    description: "Ships with the marketplace template; activation requires passing it.",
    tasks: template.starterEvals,
  });
  await ctx.store.audit({
    organizationId: ctx.organizationId,
    actor: { kind: "user", id: c.get("actor").user.id },
    action: "marketplace.hire",
    targetType: "employee",
    targetId: employee.id,
    metadata: { templateId: template.id, name: input.name },
  });
  return c.json({ employee, evalTasks: template.starterEvals.length }, 201);
});
