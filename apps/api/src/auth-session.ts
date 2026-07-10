import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Session auth primitives (ADR-0025): scrypt password hashing and
 * HMAC-signed stateless session tokens carrying { userId, organizationId,
 * exp }. The signing secret comes from WANKONG_AUTH_SECRET; without one, a
 * per-process secret is generated (sessions then die with the process —
 * fine for demos, loudly documented for production). SSO/OIDC plugs in at
 * the same seam by minting the same token after its own verification.
 */
const secret = process.env.WANKONG_AUTH_SECRET ?? randomBytes(32).toString("hex");

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export interface SessionClaims {
  userId: string;
  organizationId: string;
  exp: number;
}

const b64u = (buf: Buffer) => buf.toString("base64url");

export function signSession(claims: SessionClaims): string {
  const payload = b64u(Buffer.from(JSON.stringify(claims)));
  const mac = createHmac("sha256", secret).update(payload).digest();
  return `wks_${payload}.${b64u(mac)}`;
}

export function verifySession(token: string): SessionClaims | null {
  if (!token.startsWith("wks_")) return null;
  const [payload, mac] = token.slice(4).split(".");
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionClaims;
    if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
    if (!claims.userId || !claims.organizationId) return null;
    return claims;
  } catch {
    return null;
  }
}
