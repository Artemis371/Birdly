import { NextResponse } from "next/server";
import { json } from "@/lib/api-response";
import { readJson } from "@/lib/auth/guard";
import { recoveryCookie } from "@/lib/auth/recovery";
import { isConfigured } from "@/lib/env";
import { LIMITS, allow, clientIp } from "@/lib/rate-limit";
import { routeSessionClient } from "@/lib/supabase/server";

// Fallback for Supabase's DEFAULT reset email, which sends people to the site
// root with the session in the URL fragment (#access_token=...&type=recovery).
// The browser posts those tokens here; we verify them with Supabase and only
// accept sessions created by an emailed one-time link (amr "otp"/"magiclink"),
// never a normal password login. Then we sign the person in and allow a
// password change without the old password.
export async function POST(req: Request) {
  if (!isConfigured()) return json({ error: "Accounts aren't set up on this server yet." }, { status: 503 });
  if (!(await allow("recovery-ip", clientIp(req), LIMITS.forgotPerIp))) {
    return json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }
  const body = await readJson(req);
  const access_token = typeof body.accessToken === "string" ? body.accessToken : "";
  const refresh_token = typeof body.refreshToken === "string" ? body.refreshToken : "";
  if (!access_token || !refresh_token || access_token.length > 8000 || refresh_token.length > 2000) {
    return json({ error: "That reset link is incomplete." }, { status: 400 });
  }

  const { supabase, apply } = await routeSessionClient();
  const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error || !data.user) return json({ error: "That reset link expired or was already used." }, { status: 400 });

  const { data: c } = await supabase.auth.getClaims();
  const amr = (c?.claims?.amr ?? []) as (string | { method?: string })[];
  const methods = amr.map((a) => (typeof a === "string" ? a : a.method ?? ""));
  if (!methods.some((m) => m === "otp" || m === "magiclink")) {
    await supabase.auth.signOut();
    return json({ error: "That isn't a password reset link." }, { status: 400 });
  }

  const res = apply(NextResponse.json({ ok: true }));
  const rc = recoveryCookie(data.user.id);
  res.cookies.set(rc.name, rc.value, rc.options);
  return res;
}
