import "server-only";
import { env } from "@/lib/env";
import { signToken, verifyToken } from "@/lib/signing";

// After a valid password-reset link, this short-lived signed cookie lets the
// user set a new password without knowing the old one.
export const RECOVERY_COOKIE = "birdly_recovery";
const TTL = 15 * 60;

export function recoveryCookie(userId: string) {
  return {
    name: RECOVERY_COOKIE,
    value: signToken({ u: userId }, "recovery", env.supabaseSecretKey(), TTL),
    options: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: TTL },
  };
}

export function recoveryValidFor(token: string | undefined, userId: string): boolean {
  const p = verifyToken<{ u: string }>(token, "recovery", env.supabaseSecretKey());
  return p?.u === userId;
}
