import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { recoveryCookie } from "@/lib/auth/recovery";
import { safeNext } from "@/lib/auth/validation";
import { isConfigured } from "@/lib/env";
import { routeSessionClient } from "@/lib/supabase/server";

// Landing point for password-reset links (email template or admin-generated):
// /auth/confirm?token_hash=...&type=recovery&next=/reset-password
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tokenHash = sp.get("token_hash");
  const type = sp.get("type") as EmailOtpType | null;
  const next = safeNext(sp.get("next"), "/reset-password");
  const fail = NextResponse.redirect(new URL("/forgot-password?error=expired", req.url));
  if (!isConfigured() || !tokenHash || type !== "recovery") return fail;

  const { supabase, apply } = await routeSessionClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) return fail;

  const res = NextResponse.redirect(new URL(next, req.url));
  const c = recoveryCookie(data.user.id);
  res.cookies.set(c.name, c.value, c.options);
  return apply(res);
}
