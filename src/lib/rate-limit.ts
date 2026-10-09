import "server-only";
import { createHash } from "node:crypto";
import { adminClient } from "@/lib/supabase/admin";

export const LIMITS = {
  signupPerIp: { max: 10, windowSec: 15 * 60 },
  loginPerIp: { max: 20, windowSec: 15 * 60 },
  loginPerEmail: { max: 5, windowSec: 15 * 60 },
  forgotPerIp: { max: 5, windowSec: 60 * 60 },
  forgotPerEmail: { max: 3, windowSec: 60 * 60 },
  passwordChangePerUser: { max: 5, windowSec: 15 * 60 },
  tradePerUser: { max: 30, windowSec: 60 },
} as const;

export type Limit = { max: number; windowSec: number };

// Keys are hashed so emails/IPs aren't stored in plain text.
export async function allow(bucket: string, subject: string, limit: Limit): Promise<boolean> {
  const key = `${bucket}:${createHash("sha256").update(subject.toLowerCase()).digest("hex").slice(0, 32)}`;
  const { data, error } = await adminClient().rpc("rate_limit_hit", { p_key: key, p_max: limit.max, p_window_seconds: limit.windowSec });
  if (error) {
    // Fail closed: if we can't check the limit, don't allow the attempt.
    console.error("[rate-limit]", error.message);
    return false;
  }
  return data === true;
}

// Vercel sets x-real-ip / x-forwarded-for from the real client connection.
export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
