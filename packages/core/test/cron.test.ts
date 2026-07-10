import { describe, expect, it } from "vitest";
import { CronParseError, cronMatches, isValidCron, parseCron } from "@wankong/core";

const at = (iso: string) => new Date(iso);

describe("cron matching", () => {
  it("matches every minute with * * * * *", () => {
    expect(cronMatches("* * * * *", at("2026-07-09T12:34:00Z"))).toBe(true);
  });

  it("matches exact minute/hour", () => {
    expect(cronMatches("0 9 * * *", at("2026-07-09T09:00:00Z"))).toBe(true);
    expect(cronMatches("0 9 * * *", at("2026-07-09T09:01:00Z"))).toBe(false);
    expect(cronMatches("0 9 * * *", at("2026-07-09T10:00:00Z"))).toBe(false);
  });

  it("supports steps, ranges, and lists", () => {
    expect(cronMatches("*/15 * * * *", at("2026-07-09T12:45:00Z"))).toBe(true);
    expect(cronMatches("*/15 * * * *", at("2026-07-09T12:46:00Z"))).toBe(false);
    expect(cronMatches("0 9-17 * * *", at("2026-07-09T13:00:00Z"))).toBe(true);
    expect(cronMatches("0 9 1,15 * *", at("2026-07-15T09:00:00Z"))).toBe(true);
    expect(cronMatches("0 9 1,15 * *", at("2026-07-16T09:00:00Z"))).toBe(false);
  });

  it("weekday restriction works and 7 aliases Sunday", () => {
    // 2026-07-09 is a Thursday (dow 4).
    expect(cronMatches("0 9 * * 4", at("2026-07-09T09:00:00Z"))).toBe(true);
    expect(cronMatches("0 9 * * 1-5", at("2026-07-09T09:00:00Z"))).toBe(true);
    // 2026-07-12 is a Sunday.
    expect(cronMatches("0 9 * * 7", at("2026-07-12T09:00:00Z"))).toBe(true);
  });

  it("dom+dow both restricted: OR semantics (standard cron)", () => {
    // 2026-07-09 is Thursday the 9th: dom=1 doesn't match, dow=4 does.
    expect(cronMatches("0 9 1 * 4", at("2026-07-09T09:00:00Z"))).toBe(true);
    // Neither matches on Friday the 10th.
    expect(cronMatches("0 9 1 * 4", at("2026-07-10T09:00:00Z"))).toBe(false);
  });

  it("rejects malformed expressions", () => {
    expect(() => parseCron("* * * *")).toThrow(CronParseError);
    expect(() => parseCron("61 * * * *")).toThrow(CronParseError);
    expect(() => parseCron("*/0 * * * *")).toThrow(CronParseError);
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
    expect(isValidCron("banana")).toBe(false);
  });
});
