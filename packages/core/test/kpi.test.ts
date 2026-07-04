import { describe, expect, it } from "vitest";
import { evaluateKpi, overallAttainment, type Kpi } from "@wankong/core";

const kpi = (over: Partial<Kpi>): Kpi => ({
  key: "k",
  label: "K",
  target: 100,
  unit: "",
  direction: "higher_is_better",
  ...over,
});

describe("kpi evaluation", () => {
  it("scores higher-is-better metrics", () => {
    expect(evaluateKpi(kpi({}), 120).status).toBe("exceeding");
    expect(evaluateKpi(kpi({}), 100).status).toBe("on_target");
    expect(evaluateKpi(kpi({}), 50).status).toBe("below");
  });

  it("inverts lower-is-better metrics", () => {
    const churn = kpi({ direction: "lower_is_better", target: 5 });
    expect(evaluateKpi(churn, 3).status).toBe("exceeding");
    expect(evaluateKpi(churn, 5).status).toBe("on_target");
    expect(evaluateKpi(churn, 20).status).toBe("below");
  });

  it("never divides by zero", () => {
    expect(evaluateKpi(kpi({ target: 0 }), 10).attainment).toBe(1);
    expect(evaluateKpi(kpi({ direction: "lower_is_better", target: 5 }), 0).attainment).toBe(1);
  });

  it("averages attainment across readings", () => {
    const readings = [evaluateKpi(kpi({}), 100), evaluateKpi(kpi({}), 50)];
    expect(overallAttainment(readings)).toBeCloseTo(0.75);
    expect(overallAttainment([])).toBe(0);
  });
});
