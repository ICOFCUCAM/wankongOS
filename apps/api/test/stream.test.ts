import { describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { createAppContext } from "../src/context.js";
import { emitEvent, subscribeLive } from "../src/events.js";

describe("live event stream", () => {
  it("fans emitted events out to org-scoped subscribers, isolated per org", async () => {
    const ctx = createAppContext({ store: createSeededStore(), registry: new ProviderRegistry(), organizationId: SEED_ORG_ID });
    await ctx.ready;
    const mine: string[] = [];
    const other: string[] = [];
    const un1 = subscribeLive(SEED_ORG_ID, (e) => mine.push(e.type));
    const un2 = subscribeLive("org_other", (e) => other.push(e.type));

    await emitEvent(ctx, "task.created", { taskId: "task_1" });
    expect(mine).toEqual(["task.created"]);
    expect(other).toEqual([]);

    un1();
    await emitEvent(ctx, "task.created", { taskId: "task_2" });
    expect(mine).toHaveLength(1); // unsubscribed
    un2();
  });
});
