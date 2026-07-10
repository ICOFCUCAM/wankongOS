import { planById } from "@wankong/core";
import type { AppContext } from "./context.js";

/** Returns an error string when hiring `adding` more employees would exceed the plan. */
export async function assertWithinPlan(ctx: AppContext, adding: number): Promise<string | null> {
  const org = await ctx.store.organizations.get(ctx.organizationId);
  const plan = planById(org?.plan ?? "trial");
  const active = await ctx.store.employees.listByOrg(ctx.organizationId, (e) => e.status !== "offboarded");
  if (active.length + adding > plan.maxEmployees) {
    return `Plan limit: ${plan.name} allows ${plan.maxEmployees} AI employees (you have ${active.length}). Upgrade via POST /v1/billing/plan.`;
  }
  return null;
}
