import { beforeEach, describe, expect, it } from "vitest";
import { createSeededStore, SEED_ORG_ID } from "@wankong/store";
import { ProviderRegistry } from "@wankong/agents";
import { createApp } from "../src/app.js";
import { createAppContext, type AppContext } from "../src/context.js";

let ctx: AppContext;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  ctx = createAppContext({
    store: createSeededStore(),
    registry: new ProviderRegistry(),
    organizationId: SEED_ORG_ID,
  });
  app = createApp({ context: ctx, quiet: true });
  await ctx.ready;
});
const json = (body: unknown) => ({
  method: "POST" as const,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const baseDoc = {
  title: "Q3 operations report",
  docType: "report",
  status: "internal",
  author: { name: "Ava Chen", department: "Executive Office" },
  sections: [
    { kind: "heading", text: "Summary", level: 2 },
    { kind: "paragraph", text: "Operations ran within budget this quarter.", evidence: [] },
    { kind: "kv", pairs: [{ key: "Period", value: "Q3" }] },
  ],
};

describe("Enterprise Composition Engine", () => {
  it("composes, quality-checks, renders, and files a verifiable asset", async () => {
    const res = await app.request("/v1/compose", json({ doc: baseDoc, format: "pdf" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.verification).toMatch(/^WK-[0-9A-F]{8}$/);
    expect(body.pdfAssetId).toBeTruthy();

    // The PDF carries the watermark and the verification code.
    const dl = await app.request(`/v1/assets/${body.pdfAssetId}/download`);
    const raw = Buffer.from(await dl.arrayBuffer()).toString("binary");
    expect(raw).toContain("INTERNAL"); // status watermark
    expect(raw).toContain(`Verify: ${body.verification}`);
    expect(raw).toContain("Prepared by Ava Chen"); // parens are PDF-escaped in the stream
    expect(raw).toContain("Executive Office");

    // The printed code verifies against stored records.
    const verify = await (await app.request(`/v1/verify/${body.verification}`)).json();
    expect(verify.verified).toBe(true);
    expect(verify.documents.length).toBeGreaterThanOrEqual(1);

    // A wrong code honestly fails.
    expect((await app.request("/v1/verify/WK-00000000")).status).toBe(404);
  });

  it("Quality Engine blocks placeholder text with a named rule", async () => {
    const doc = { ...baseDoc, sections: [{ kind: "paragraph", text: "TODO: fill this in later.", evidence: [] }] };
    const res = await app.request("/v1/compose", json({ doc }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("Quality Engine");
    expect(body.findings.some((f: { check: string }) => f.check === "grammar")).toBe(true);
  });

  it("Quality Engine blocks any claim that a filing was submitted", async () => {
    const doc = { ...baseDoc, sections: [{ kind: "paragraph", text: "We have filed the VAT return with the authority.", evidence: [] }] };
    const res = await app.request("/v1/compose", json({ doc }));
    expect(res.status).toBe(422);
    expect((await res.json()).findings.some((f: { check: string }) => f.check === "compliance")).toBe(true);
  });

  it("Evidence Engine: claim-bearing doc types need evidence, and refs must resolve", async () => {
    const brief = { ...baseDoc, docType: "brief", sections: [{ kind: "paragraph", text: "Supplier A breached the contract.", evidence: [] }] };
    const noEvidence = await app.request("/v1/compose", json({ doc: brief }));
    expect(noEvidence.status).toBe(422);
    expect((await noEvidence.json()).findings.some((f: { check: string }) => f.check === "evidence")).toBe(true);

    const dangling = {
      ...brief,
      sections: [{ kind: "paragraph", text: "Supplier A breached the contract.", evidence: [{ type: "task", id: "task_nonexistent" }] }],
    };
    const bad = await app.request("/v1/compose", json({ doc: dangling }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).dangling).toEqual(["task:task_nonexistent"]);

    const task = (await ctx.store.tasks.listByOrg(SEED_ORG_ID))[0]!;
    const cited = {
      ...brief,
      sections: [{ kind: "paragraph", text: "Supplier A breached the contract.", evidence: [{ type: "task", id: task.id, note: "breach investigation" }] }],
    };
    const ok = await app.request("/v1/compose", json({ doc: cited }));
    expect(ok.status).toBe(201);
    const body = await ok.json();
    expect(body.evidence[0].title).toBe(task.title);

    // Standalone resolution endpoint.
    const resolve = await (await app.request(`/v1/evidence/resolve?type=task&id=${task.id}`)).json();
    expect(resolve.exists).toBe(true);
    expect(resolve.title).toBe(task.title);
  });

  it("policy findings come from the DNA's brand policy", async () => {
    const doc = {
      ...baseDoc,
      sections: [{ kind: "paragraph", text: "Our world-class product from Acme Robotics leads the market.", evidence: [] }],
    };
    const res = await app.request("/v1/compose", json({ doc }));
    expect(res.status).toBe(201); // warn, not error
    const body = await res.json();
    const policy = body.qualityReport.findings.find((f: { check: string }) => f.check === "policy");
    expect(policy.message).toContain("Brand Policy v1");
    expect(policy.message).toContain("superlative");
  });
});
