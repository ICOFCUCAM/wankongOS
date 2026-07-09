import { describe, expect, it } from "vitest";
import { evaluateCondition, getPath, renderTemplate } from "@wankong/core";

describe("condition evaluation", () => {
  const ctx = { lead: { score: 80, company: "BigCo", tags: ["enterprise"] }, ok: true };

  it("reads dot-paths", () => {
    expect(getPath(ctx, "lead.company")).toBe("BigCo");
    expect(getPath(ctx, "lead.missing.deep")).toBeUndefined();
  });

  it("evaluates numeric comparisons", () => {
    expect(evaluateCondition(ctx, { path: "lead.score", op: "gte", value: 70 })).toBe(true);
    expect(evaluateCondition(ctx, { path: "lead.score", op: "lt", value: 70 })).toBe(false);
  });

  it("evaluates existence, truthiness, and contains", () => {
    expect(evaluateCondition(ctx, { path: "ok", op: "truthy" })).toBe(true);
    expect(evaluateCondition(ctx, { path: "lead.company", op: "exists" })).toBe(true);
    expect(evaluateCondition(ctx, { path: "missing", op: "exists" })).toBe(false);
    expect(evaluateCondition(ctx, { path: "lead.tags", op: "contains", value: "enterprise" })).toBe(
      true,
    );
  });
});

describe("template rendering", () => {
  it("fills tokens from context and blanks missing ones", () => {
    const out = renderTemplate("Hi {{lead.name}} at {{lead.company}}!", {
      lead: { company: "BigCo" },
    });
    expect(out).toBe("Hi  at BigCo!");
  });
});
