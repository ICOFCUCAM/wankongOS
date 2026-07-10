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

describe("builtin generators produce real files", () => {
  it("document/invoice totals line items into markdown", async () => {
    const res = await app.request(
      "/v1/studios/document/generate",
      json({ kind: "invoice", title: "INV-42", data: { billTo: "BigCo", items: [{ description: "Consulting", qty: 2, unitPrice: 500 }] } }),
    );
    expect(res.status).toBe(201);
    const asset = await res.json();
    expect(asset.mimeType).toBe("text/markdown");
    expect(asset.content).toContain("**Total: $1000.00**");
  });

  it("design/business_card renders brand-driven SVG", async () => {
    await app.request("/v1/brand", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ colors: { primary: "#ff0000", secondary: "#111111", accent: "#00ff00" } }) });
    const res = await app.request("/v1/studios/design/generate", json({ kind: "business_card", title: "Card", data: { name: "Ava Chen", subtitle: "Executive Assistant" } }));
    const asset = await res.json();
    expect(asset.mimeType).toBe("image/svg+xml");
    expect(asset.content).toContain("#ff0000");
    expect(asset.content).toContain("Ava Chen");
  });

  it("financial/spend_report reads recorded usage", async () => {
    const res = await app.request("/v1/studios/financial/generate", json({ kind: "spend_report" }));
    const asset = await res.json();
    expect(asset.content).toContain("Total estimated spend");
  });

  it("cad/floor_plan lays out rooms as SVG", async () => {
    const res = await app.request("/v1/studios/cad/generate", json({ kind: "floor_plan", title: "Office", data: { rooms: [{ name: "Lobby", size: "6x4m" }, { name: "Workshop", size: "10x8m" }] } }));
    const asset = await res.json();
    expect(asset.content).toContain("Lobby");
    expect(asset.content.startsWith("<svg")).toBe(true);
  });

  it("conversion/csv_to_json round-trips structure", async () => {
    const res = await app.request("/v1/studios/conversion/generate", json({ kind: "csv_to_json", data: { source: "name,qty\nWidget,3" } }));
    const asset = await res.json();
    expect(JSON.parse(asset.content)).toEqual([{ name: "Widget", qty: "3" }]);
  });

  it("422s for connector-tier kinds with an honest message", async () => {
    const res = await app.request("/v1/studios/video/generate", json({ kind: "commercial" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Integration Hub");
  });
});

describe("employees produce assets via the studio.produce tool", () => {
  it("creates a stored, audited asset attributed to the employee", async () => {
    const { createAppContext } = await import("../src/context.js");
    const { createSeededStore: seed, SEED_ORG_ID: ORG } = await import("@wankong/store");
    const { ProviderRegistry: PR } = await import("@wankong/agents");
    const { LocalEmbedder } = await import("@wankong/knowledge");
    const ctx = createAppContext({
      store: seed(),
      registry: new PR(),
      embedder: new LocalEmbedder(),
      organizationId: ORG,
    });
    await ctx.ready;
    const out = await ctx.toolRegistry.execute(
      "studio.produce",
      { studioId: "document", kind: "sop", title: "Refund SOP", data: { purpose: "Handle refunds", steps: "1. Verify order" } },
      { organizationId: ORG, employeeId: "emp_support_manager", permissions: ["task:create"] },
    );
    expect(String(out)).toContain("Produced");
    const assets = await ctx.store.assets.list(() => true);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.createdBy).toEqual({ kind: "employee", id: "emp_support_manager" });
    const audits = await ctx.store.auditEvents.list((a) => a.action === "studio.generate");
    expect(audits).toHaveLength(1);
  });
});
