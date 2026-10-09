import { createHash, timingSafeEqual } from "node:crypto";

// Constant-time comparison so response timing doesn't leak the invite code.
// Case-insensitive and ignores surrounding spaces, since people type it on phones.
export function inviteCodeMatches(given: unknown, expected: string): boolean {
  const norm = (s: string) => createHash("sha256").update(s.trim().toLowerCase()).digest();
  return typeof given === "string" && given.length <= 200 && timingSafeEqual(norm(given), norm(expected));
}
