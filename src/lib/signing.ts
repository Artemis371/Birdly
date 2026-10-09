import { createHmac, timingSafeEqual } from "node:crypto";

// Tamper-proof, expiring tokens (quote tokens, recovery cookie). The key is
// derived from a server secret with a purpose label, so a token minted for
// one purpose can't be replayed as another.

function key(secret: string, purpose: string): Buffer {
  return createHmac("sha256", secret).update(`birdly:${purpose}:v1`).digest();
}

export function signToken(payload: object, purpose: string, secret: string, ttlSec: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSec })).toString("base64url");
  const mac = createHmac("sha256", key(secret, purpose)).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyToken<T>(token: unknown, purpose: string, secret: string, now = Date.now()): (T & { exp: number }) | null {
  if (typeof token !== "string" || token.length > 4096) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", key(secret, purpose)).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || payload.exp * 1000 < now) return null;
    return payload;
  } catch {
    return null;
  }
}
