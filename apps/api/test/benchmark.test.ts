import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { ROLE_TEMPLATES } from "@wankong/core";
import { createApp } from "../src/app.js";
import { createAppContext, type AppContext } from "../src/context.js";

/**
 * The published benchmark (docs/BENCHMARKS.md): every marketplace template
 * must hire, run its starter suite, and ACTIVATE on the hermetic local
 * provider. A template that can't pass its own evals doesn't ship.
 */
let ctx: AppContext;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  ctx = createAppContext({ store: createSeededStore(), registry: new ProviderRegistry(), organizationId: SEED_ORG_ID });
  app = createApp({ context: ctx, quiet: true });
  await ctx.ready;
  await ctx.store.organizations.update(SEED_ORG_ID, { plan: "enterprise" });
});
const json = (body: unknown) => ({
  method: "POST" as const,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("benchmark: every template earns activation", () => {
  it("hires and eval-activates all marketplace templates on the local provider", async () => {
    const results: { template: string; activated: boolean }[] = [];
    for (const t of ROLE_TEMPLATES) {
      const hired = await (await app.request("/v1/marketplace/hire", json({ templateId: t.id, name: `Bench ${t.title}` }))).json();
      const res = await app.request(`/v1/employees/${hired.employee.id}/activate`, json({}));
      results.push({ template: t.id, activated: res.status === 200 });
    }
    const failed = results.filter((r) => !r.activated);
    expect(failed, `templates failing their own suite: ${failed.map((f) => f.template).join(", ")}`).toHaveLength(0);
    expect(results).toHaveLength(ROLE_TEMPLATES.length);
  });
});
