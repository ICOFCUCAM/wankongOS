import type { ProviderId } from "./enums.js";

/**
 * Estimated AI cost accounting (USD per million tokens). These are list-price
 * approximations for the models the platform defaults to — good enough to
 * rank spend and trend it, and always labelled as estimates. Update alongside
 * provider pricing pages; unknown models fall back to their provider default.
 */
interface Rate {
  inPerMTok: number;
  outPerMTok: number;
}

const MODEL_RATES: Record<string, Rate> = {
  // Anthropic
  "claude-sonnet-5": { inPerMTok: 3, outPerMTok: 15 },
  "claude-opus-4-8": { inPerMTok: 15, outPerMTok: 75 },
  "claude-haiku-4-5-20251001": { inPerMTok: 1, outPerMTok: 5 },
  // OpenAI
  "gpt-4o": { inPerMTok: 2.5, outPerMTok: 10 },
  "gpt-4o-mini": { inPerMTok: 0.15, outPerMTok: 0.6 },
  // Google
  "gemini-1.5-pro": { inPerMTok: 1.25, outPerMTok: 5 },
  "gemini-1.5-flash": { inPerMTok: 0.075, outPerMTok: 0.3 },
};

const PROVIDER_DEFAULTS: Record<ProviderId, Rate> = {
  anthropic: { inPerMTok: 3, outPerMTok: 15 },
  openai: { inPerMTok: 2.5, outPerMTok: 10 },
  google: { inPerMTok: 1.25, outPerMTok: 5 },
  local: { inPerMTok: 0, outPerMTok: 0 },
};

/** Estimated cost in USD for a token exchange. Local models cost 0. */
export function estimateCostUsd(
  provider: ProviderId,
  model: string | undefined,
  tokensIn: number,
  tokensOut: number,
): number {
  const rate = (model && MODEL_RATES[model]) || PROVIDER_DEFAULTS[provider];
  const cost = (tokensIn / 1_000_000) * rate.inPerMTok + (tokensOut / 1_000_000) * rate.outPerMTok;
  return Math.round(cost * 1_000_000) / 1_000_000; // micro-dollar precision
}
