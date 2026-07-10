import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { createApp } from "../src/app.js";
import { createAppContext } from "../src/context.js";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp({
    context: createAppContext({
      store: createSeededStore(),
      registry: new ProviderRegistry(),
      organizationId: SEED_ORG_ID,
    }),
    quiet: true,
  });
});
const json = (body: unknown) => ({
  method: "POST" as const,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("production studios", () => {
  it("lists the catalog with derived availability", async () => {
    const { data } = await (await app.request("/v1/studios")).json();
    expect(data.length).toBeGreaterThanOrEqual(16);
    const doc = data.find((s: { id: string }) => s.id === "document");
    expect(doc.active).toBe(true); // builtin
    const video = data.find((s: { id: string }) => s.id === "video");
    expect(video.active).toBe(false); // no connector configured
    expect(video.availability).toBe("connector");
  });

  it("creates, versions, and lists assets", async () => {
    const created = await app.request(
      "/v1/assets",
      json({ studioId: "document", kind: "report", title: "Q3 Report", mimeType: "text/markdown", content: "# Q3", tags: ["finance"] }),
    );
    expect(created.status).toBe(201);
    const asset = await created.json();
    expect(asset.version).toBe(1);

    const patched = await app.request(`/v1/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "# Q3 v2" }),
    });
    expect((await patched.json()).version).toBe(2);

    const list = await (await app.request("/v1/assets?tag=finance")).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].bytes).toBeGreaterThan(0);
    expect(list.data[0].content).toBeUndefined(); // list is metadata-only
  });

  it("brand kit: defaults on first read, updatable with org:manage", async () => {
    const kit = await (await app.request("/v1/brand")).json();
    expect(kit.colors.primary).toBe("#6d5efc");
    const put = await app.request("/v1/brand", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toneOfVoice: "Bold and playful.", tagline: "Robots, but friendly." }),
    });
    expect((await put.json()).toneOfVoice).toBe("Bold and playful.");
  });
});
