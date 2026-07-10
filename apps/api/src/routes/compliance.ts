import { Hono } from "hono";
import type { Env } from "../context.js";
import { authorize } from "../http.js";

export const complianceRoutes = new Hono<Env>();

/**
 * Compliance evidence pack (§3.4): one document an auditor can read —
 * who can do what, every consequential action with its actor, every human
 * approval with its decider, quality evidence (eval reports), and change
 * history. Assembled entirely from stored records; secrets and credential
 * material are structurally absent (only hashes/redacted configs exist).
 */
complianceRoutes.get("/compliance/evidence", async (c) => {
  authorize(c, "audit:read");
  const ctx = c.get("ctx");
  const orgId = ctx.organizationId;

  const [org, users, employees, approvals, auditEvents, evalReports, versions, apiKeys, webhooks, integrations] =
    await Promise.all([
      ctx.store.organizations.get(orgId),
      ctx.store.users.list((u) => u.organizationId === orgId),
      ctx.store.employees.list((e) => e.organizationId === orgId),
      ctx.store.approvals.list((a) => a.organizationId === orgId),
      ctx.store.auditEvents.list((a) => a.organizationId === orgId),
      ctx.store.evalReports.list((r) => r.organizationId === orgId),
      ctx.store.employeeVersions.list((v) => v.organizationId === orgId),
      ctx.store.apiKeys.list((k) => k.organizationId === orgId),
      ctx.store.webhooks.list((w) => w.organizationId === orgId),
      ctx.store.integrations.list((i) => i.organizationId === orgId),
    ]);

  auditEvents.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return c.json({
    generatedAt: new Date().toISOString(),
    organization: { id: org?.id, name: org?.name, plan: org?.plan },
    accessControl: {
      humans: users.map((u) => ({ id: u.id, email: u.email, role: u.role, status: u.status })),
      aiEmployees: employees.map((e) => ({
        id: e.id,
        name: e.name,
        title: e.title,
        status: e.status,
        permissions: e.permissions,
        approvalRules: e.approvalRules,
        escalationRules: e.escalationRules,
        dailyTokenBudget: e.dailyTokenBudget ?? null,
      })),
    },
    humanOversight: {
      approvals: approvals.map((a) => ({
        id: a.id,
        summary: a.summary,
        status: a.status,
        requestedBy: a.requestedBy,
        decidedBy: a.decidedBy ?? null,
        decidedAt: a.decidedAt ?? null,
      })),
    },
    quality: {
      evalReports: evalReports.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        trigger: r.trigger,
        pass: r.pass,
        passedTasks: r.passedTasks,
        totalTasks: r.totalTasks,
        createdAt: r.createdAt,
      })),
    },
    changeManagement: {
      configVersions: versions.map((v) => ({
        employeeId: v.employeeId,
        version: v.version,
        changedBy: v.changedBy,
        changeSummary: v.changeSummary,
        createdAt: v.createdAt,
      })),
    },
    machineAccess: {
      apiKeys: apiKeys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: k.scopes,
        revokedAt: k.revokedAt ?? null,
        lastUsedAt: k.lastUsedAt ?? null,
      })),
      webhooks: webhooks.map((w) => ({ id: w.id, url: w.url, events: w.events, active: w.active })),
      integrations: integrations.map((i) => ({ id: i.id, kind: i.kind, name: i.name, status: i.status })),
    },
    auditTrail: auditEvents.map((a) => ({
      at: a.createdAt,
      actor: a.actor,
      action: a.action,
      targetType: a.targetType ?? null,
      targetId: a.targetId ?? null,
    })),
  });
});
