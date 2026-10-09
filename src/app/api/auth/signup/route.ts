import { json } from "@/lib/api-response";
import { readJson } from "@/lib/auth/guard";
import { signup } from "@/lib/auth/signup";
import { env, isConfigured } from "@/lib/env";
import { LIMITS, allow, clientIp } from "@/lib/rate-limit";
import { adminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { routeSessionClient } from "@/lib/supabase/server";

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function POST(req: Request) {
  if (!isConfigured()) return json({ error: "Accounts aren't set up on this server yet." }, { status: 503 });
  const body = await readJson(req);
  const db = adminClient();

  const result = await signup(body, {
    inviteCode: env.inviteCode(),
    allowAttempt: () => allow("signup-ip", clientIp(req), LIMITS.signupPerIp),
    displayNameTaken: async (name) => {
      const { data } = await db.from("profiles").select("id").ilike("display_name", escapeLike(name)).limit(1);
      return (data?.length ?? 0) > 0;
    },
    createUser: async (email, password, displayName) => {
      // email_confirm: true skips the confirmation email; the invite code gates entry.
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
      if (error || !data.user) return { ok: false, code: error?.code ?? "unknown", message: error?.message ?? "" };
      return { ok: true, userId: data.user.id };
    },
  });

  if (!result.ok) return json({ error: result.error, field: result.field }, { status: result.status });

  // Sign the new user straight in.
  const { supabase, apply } = await routeSessionClient();
  await supabase.auth.signInWithPassword({ email: result.email, password: result.password });
  return apply(NextResponse.json({ ok: true }));
}
