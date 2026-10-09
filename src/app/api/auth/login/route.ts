import { json } from "@/lib/api-response";
import { readJson } from "@/lib/auth/guard";
import { normalizeEmail } from "@/lib/auth/validation";
import { isConfigured } from "@/lib/env";
import { LIMITS, allow, clientIp } from "@/lib/rate-limit";
import { adminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { routeSessionClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  if (!isConfigured()) return json({ error: "Accounts aren't set up on this server yet." }, { status: 503 });
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email) {
    const typed = typeof body.email === "string" ? body.email.trim() : "";
    return json(
      {
        error: typed
          ? "That doesn't look like an email address. If your browser autofilled it, it may have put your display name here. Type your email instead."
          : "Enter your email.",
        field: "email",
      },
      { status: 400 },
    );
  }
  if (!password) return json({ error: "Enter your password.", field: "password" }, { status: 400 });

  const [ipOk, emailOk] = await Promise.all([
    allow("login-ip", clientIp(req), LIMITS.loginPerIp),
    allow("login-email", email, LIMITS.loginPerEmail),
  ]);
  if (!ipOk || !emailOk) return json({ error: "Too many login attempts. Wait 15 minutes and try again." }, { status: 429 });

  const { supabase, apply } = await routeSessionClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    if (error?.code === "user_banned") return json({ error: "This account has been deactivated. Ask the admin if that's a mistake." }, { status: 403 });
    return json({ error: "Wrong email or password." }, { status: 401 });
  }
  const { data: profile } = await adminClient().from("profiles").select("deactivated_at").eq("id", data.user.id).maybeSingle();
  if (!profile || profile.deactivated_at) {
    await supabase.auth.signOut();
    return apply(NextResponse.json({ error: "This account has been deactivated. Ask the admin if that's a mistake." }, { status: 403 }));
  }
  return apply(NextResponse.json({ ok: true }));
}
