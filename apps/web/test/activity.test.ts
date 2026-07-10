import { describe, expect, it } from "vitest";
import { ACTIVITY_STATUS_ORDER } from "@wankong/core";
import { ACTIVITY_ORDER, ACTIVITY_STYLES, activityStyle } from "../lib/activity";

describe("console status vocabulary", () => {
  it("covers every presence state the core model can derive", () => {
    for (const status of ACTIVITY_STATUS_ORDER) {
      expect(ACTIVITY_STYLES[status], `missing style for "${status}"`).toBeDefined();
      expect(ACTIVITY_STYLES[status].label.length).toBeGreaterThan(0);
      expect(ACTIVITY_STYLES[status].dot).toMatch(/^bg-/);
    }
  });

  it("rolls up in the same urgency order as the core model", () => {
    expect(ACTIVITY_ORDER).toEqual(ACTIVITY_STATUS_ORDER);
  });

  it("falls back to idle for unknown statuses instead of crashing", () => {
    expect(activityStyle("nonsense")).toBe(ACTIVITY_STYLES.idle);
  });

  it("assigns distinct colors to distinct states (no ambiguous dots)", () => {
    const dots = Object.values(ACTIVITY_STYLES).map((s) => s.dot);
    expect(new Set(dots).size).toBe(dots.length);
  });
});
