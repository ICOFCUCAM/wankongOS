import { describe, expect, it } from "vitest";
import { estimateCostUsd, redactPii } from "@wankong/core";

describe("cost estimation", () => {
  it("prices known models per token", () => {
    // 1M in + 1M out on sonnet = $3 + $15.
    expect(estimateCostUsd("anthropic", "claude-sonnet-5", 1_000_000, 1_000_000)).toBe(18);
    expect(estimateCostUsd("openai", "gpt-4o-mini", 2_000_000, 0)).toBeCloseTo(0.3);
  });

  it("local models cost zero; unknown models use provider defaults", () => {
    expect(estimateCostUsd("local", "wankong-local-1", 5_000_000, 5_000_000)).toBe(0);
    expect(estimateCostUsd("anthropic", "claude-mystery", 1_000_000, 0)).toBe(3);
  });
});

describe("PII redaction", () => {
  it("redacts emails, SSNs, and formatted phone numbers with typed placeholders", () => {
    const { text, redactions } = redactPii(
      "Reach Dana at dana@bigco.com or +1 415-555-0134; SSN 123-45-6789.",
    );
    expect(text).toContain("[redacted:email]");
    expect(text).toContain("[redacted:phone]");
    expect(text).toContain("[redacted:ssn]");
    expect(text).not.toContain("dana@bigco.com");
    expect(redactions.map((r) => r.label).sort()).toEqual(["email", "phone", "ssn"]);
  });

  it("redacts Luhn-valid card numbers but leaves random digit runs alone", () => {
    const valid = redactPii("Card: 4242 4242 4242 4242 please");
    expect(valid.text).toContain("[redacted:card]");

    const invalid = redactPii("Order number 1234 5678 9012 3456 shipped");
    expect(invalid.text).toContain("1234 5678 9012 3456");
    expect(invalid.redactions.find((r) => r.label === "card")).toBeUndefined();
  });

  it("leaves ordinary business text untouched", () => {
    const input = "Q3 revenue grew 23% to $1.2M across 415 accounts in 2026.";
    const { text, redactions } = redactPii(input);
    expect(text).toBe(input);
    expect(redactions).toHaveLength(0);
  });
});
