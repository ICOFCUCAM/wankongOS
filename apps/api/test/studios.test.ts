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
    expect(data.length).toBeGreaterThanOrEqual(18);
    const cu = data.find((s: { id: string }) => s.id === "computer-use");
    expect(cu.active).toBe(false); // honestly gated until a connector exists
    expect(cu.connectors).toContain("anthropic-computer-use");
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

describe("publishing studio goes live over Slack", () => {
  it("is gated without a channel, publishes and records with one", async () => {
    const gated = await app.request("/v1/studios/publishing/publish", json({ text: "We shipped v2!" }));
    expect(gated.status).toBe(422);

    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(init?.body));
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    try {
      // Connect Slack through the real integrations API, then check the catalog lights up.
      await app.request("/v1/integrations", json({ kind: "slack", name: "Announcements", config: { webhookUrl: "https://hooks.slack.example/T/B" } }));
      const studios = (await (await app.request("/v1/studios")).json()).data;
      const publishing = studios.find((s: { id: string }) => s.id === "publishing");
      expect(publishing.active).toBe(true);
      expect(publishing.connectedVia).toContain("slack");

      const res = await app.request("/v1/studios/publishing/publish", json({ text: "We shipped v2!", title: "Release note" }));
      expect(res.status).toBe(201);
      const { asset, delivery } = await res.json();
      expect(delivery.delivered).toBe(true);
      expect(calls[0]).toContain("shipped v2");
      expect(asset.studioId).toBe("publishing");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("engineering studio files real GitHub issues", () => {
  it("gated without a token; files, records, and audits with one", async () => {
    const gated = await app.request("/v1/studios/engineering/issue", json({ repo: "acme/robots", title: "Fix gripper drift" }));
    expect(gated.status).toBe(422);

    const realFetch = globalThis.fetch;
    let captured: { url: string; auth: string | undefined } | null = null;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), auth: (init?.headers as Record<string, string>)?.authorization };
      return new Response(JSON.stringify({ number: 42, html_url: "https://github.com/acme/robots/issues/42" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      await app.request("/v1/integrations", json({ kind: "github", name: "Acme repos", config: { token: "ghp_test" } }));
      const res = await app.request("/v1/studios/engineering/issue", json({ repo: "acme/robots", title: "Fix gripper drift", body: "Drifts 2mm under load." }));
      expect(res.status).toBe(201);
      const { asset, issue } = await res.json();
      expect(issue.number).toBe(42);
      expect(asset.title).toContain("acme/robots#42");
      expect(captured!.url).toBe("https://api.github.com/repos/acme/robots/issues");
      expect(captured!.auth).toBe("Bearer ghp_test");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("real PDF output", () => {
  it("renders a markdown asset to a valid, downloadable PDF", async () => {
    const inv = await (await app.request("/v1/studios/document/generate", json({
      kind: "invoice", title: "INV-PDF", data: { billTo: "BigCo", items: [{ description: "Consulting", qty: 1, unitPrice: 250 }] },
    }))).json();
    const rendered = await app.request(`/v1/assets/${inv.id}/render-pdf`, json({}));
    expect(rendered.status).toBe(201);
    const { id, bytes } = await rendered.json();
    expect(bytes).toBeGreaterThan(500);

    const dl = await app.request(`/v1/assets/${id}/download`);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    const buf = Buffer.from(await dl.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.toString("binary")).toContain("%%EOF");
    expect(buf.toString("binary")).toContain("Consulting");
  });
});

describe("binary asset upload", () => {
  it("stores and round-trips a binary upload; rejects non-base64", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const up = await app.request("/v1/assets/upload", json({
      title: "logo.png", mimeType: "image/png", base64: bytes.toString("base64"), tags: ["brand"],
    }));
    expect(up.status).toBe(201);
    const { id, bytes: size } = await up.json();
    expect(size).toBeGreaterThanOrEqual(7);

    const dl = await app.request(`/v1/assets/${id}/download`);
    expect(dl.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await dl.arrayBuffer()).equals(bytes)).toBe(true);

    const bad = await app.request("/v1/assets/upload", json({ title: "x", mimeType: "image/png", base64: "not base64 !!!" }));
    expect(bad.status).toBe(400);
  });
});

describe("branded documents", () => {
  it("stamps letterhead, footer, and company stamp onto rendered PDFs", async () => {
    const src = await (
      await app.request("/v1/studios/financial/generate", json({ kind: "spend_report" }))
    ).json();
    const res = await app.request(`/v1/assets/${src.id}/render-pdf`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const dl = await app.request(`/v1/assets/${id}/download`);
    const raw = Buffer.from(await dl.arrayBuffer()).toString("binary");
    expect(raw.startsWith("%PDF-1.4")).toBe(true);
    expect(raw).toContain("Helvetica-Bold"); // letterhead company name
    expect(raw).toContain("Acme Robotics"); // real org name on the page
    expect(raw).toContain(`Document no. ${src.id}`); // traceable to the record
    expect(raw).toContain("COMPANY RECORD"); // stamp — never a government seal
    expect(raw).toContain("Page 1 of 1");
    expect(raw).toContain(" rg"); // brand color fill operators present
  });
});
