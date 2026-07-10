/**
 * Platform billing (M6): plans as data, metering from recorded usage, and
 * limits enforced at the door. Payment collection attaches via a Stripe
 * connector; until then invoices are documents, never charges.
 */
export interface Plan {
  id: "trial" | "starter" | "growth" | "enterprise";
  name: string;
  priceUsdMonthly: number;
  maxEmployees: number;
  /** Org-wide daily token allowance (sum across employees). */
  dailyTokenAllowance: number;
  notes: string[];
}

export const PLANS: Plan[] = [
  { id: "trial", name: "Trial", priceUsdMonthly: 0, maxEmployees: 3, dailyTokenAllowance: 200_000, notes: ["14-day evaluation intent; not enforced by date yet."] },
  { id: "starter", name: "Starter", priceUsdMonthly: 99, maxEmployees: 10, dailyTokenAllowance: 2_000_000, notes: [] },
  { id: "growth", name: "Growth", priceUsdMonthly: 499, maxEmployees: 50, dailyTokenAllowance: 20_000_000, notes: [] },
  { id: "enterprise", name: "Enterprise", priceUsdMonthly: 2499, maxEmployees: 1000, dailyTokenAllowance: Number.MAX_SAFE_INTEGER, notes: ["Custom contracts supersede this listing."] },
];

export function planById(id: string): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0]!;
}
