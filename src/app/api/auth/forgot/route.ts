import { json } from "@/lib/api-response";
import { readJson } from "@/lib/auth/guard";
import { normalizeEmail } from "@/lib/auth/validation";
import { isConfigured } from "@/lib/env";
import { LIMITS, allow, clientIp } from "@/lib/rate-limit";
import { statelessClient } from "@/lib/supabase/admin";

// Always answers the same way so nobody can probe which emails have accounts.
const SENT = { ok: true, message: "If that email has an account, a reset link is on its way. Check spam too." };

export async function POST(req: Request) {
  if (!isConfigured()) return json({ error: "Accounts aren't set up on this server yet." }, { status: 503 });
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: "Enter a valid email address." }, { status: 400 });
  const [ipOk, emailOk] = await Promise.all([
    allow("forgot-ip", clientIp(req), LIMITS.forgotPerIp),
    allow("forgot-email", email, LIMITS.forgotPerEmail),
  ]);
  if (!ipOk || !emailOk) return json({ error: "Too many reset requests. Try again in an hour, or ask the admin for a reset link." }, { status: 429 });

  // The link in the email comes from the "Reset Password" template in Supabase,
  // which must point at /auth/confirm (see README).
  const { error } = await statelessClient().auth.resetPasswordForEmail(email);
  if (error) console.error("[forgot]", error.code, error.message);
  return json(SENT);
}
