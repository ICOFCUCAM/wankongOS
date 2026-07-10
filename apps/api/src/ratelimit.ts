import type { MiddlewareHandler } from "hono";
import type { Env } from "./context.js";

export interface RateLimitOptions {
  /** Window length. Default 60s. */
  windowMs?: number;
  /** Chat/AI requests per actor per window (the expensive class). Default 30. */
  chatPerWindow?: number;
  /** All other requests per actor per window. Default 300. */
  defaultPerWindow?: number;
}

/**
 * Sliding-window rate limiting per actor (user or API key) and route class.
 * Chat/AI routes get a tighter budget than CRUD. Exceeding the window returns
 * 429 with a Retry-After header.
 *
 * State is per process — correct on a long-running host; on serverless it
 * bounds each instance (a shared limiter store arrives with the worker/queue
 * infrastructure). Limits are configurable via options or env
 * (RATE_LIMIT_CHAT / RATE_LIMIT_DEFAULT).
 */
export function rateLimit(options: RateLimitOptions = {}): MiddlewareHandler<Env> {
  const windowMs = options.windowMs ?? 60_000;
  const limits = {
    chat: options.chatPerWindow ?? Number(process.env.RATE_LIMIT_CHAT ?? 30),
    default: options.defaultPerWindow ?? Number(process.env.RATE_LIMIT_DEFAULT ?? 300),
  };
  const hits = new Map<string, number[]>();

  return async (c, next) => {
    const cls: keyof typeof limits =
      c.req.path.includes("/chat") || c.req.path.includes("/evals/run") ? "chat" : "default";
    const actor = c.get("actor");
    const key = `${actor.user.id}:${cls}`;
    const now = Date.now();

    const windowHits = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (windowHits.length >= limits[cls]) {
      const oldest = windowHits[0]!;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      c.header("retry-after", String(retryAfterSec));
      return c.json(
        {
          error: `Rate limit exceeded (${limits[cls]} ${cls} requests per ${windowMs / 1000}s). Retry in ${retryAfterSec}s.`,
        },
        429,
      );
    }
    windowHits.push(now);
    hits.set(key, windowHits);

    // Opportunistic cleanup so idle actors don't accumulate forever.
    if (hits.size > 10_000) {
      for (const [k, v] of hits) {
        if (v.every((t) => now - t >= windowMs)) hits.delete(k);
      }
    }

    await next();
  };
}
