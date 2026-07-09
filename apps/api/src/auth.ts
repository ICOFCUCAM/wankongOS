import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ApiKey, Permission } from "@wankong/core";
import type { Store } from "@wankong/store";

/**
 * API keys: `wk_live_<40 hex>`. Only a SHA-256 hash is ever stored — the
 * plaintext is shown once at creation. The stored prefix (first characters of
 * the key) lets users recognise keys in lists without exposing the secret.
 */
const KEY_PREFIX = "wk_live_";

export interface GeneratedKey {
  plaintext: string;
  hashedKey: string;
  prefix: string;
}

export function generateApiKey(): GeneratedKey {
  const plaintext = KEY_PREFIX + randomBytes(20).toString("hex");
  return {
    plaintext,
    hashedKey: hashApiKey(plaintext),
    prefix: plaintext.slice(0, KEY_PREFIX.length + 6),
  };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(KEY_PREFIX);
}

/** Constant-time hash comparison to avoid timing side-channels. */
function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface ResolvedApiKey {
  key: ApiKey;
  permissions: Set<Permission>;
}

/**
 * Resolve a presented API key to its record and scopes. Returns null for
 * unknown or revoked keys. Touches `lastUsedAt` on success.
 */
export async function resolveApiKey(
  store: Store,
  organizationId: string,
  plaintext: string,
): Promise<ResolvedApiKey | null> {
  const hash = hashApiKey(plaintext);
  const keys = await store.apiKeys.list((k) => k.organizationId === organizationId);
  const match = keys.find((k) => !k.revokedAt && hashesEqual(k.hashedKey, hash));
  if (!match) return null;
  await store.apiKeys.update(match.id, { lastUsedAt: new Date().toISOString() });
  return { key: match, permissions: new Set(match.scopes) };
}
