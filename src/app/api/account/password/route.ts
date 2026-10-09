import { cookies } from "next/headers";
import { json } from "@/lib/api-response";
import { readJson, requireUser } from "@/lib/auth/guard";
import { RECOVERY_COOKIE, recoveryValidFor } from "@/lib/auth/recovery";
import { validatePassword } from "@/lib/auth/validation";
import { LIMITS, allow } from "@/lib/rate-limit";
import { adminClient, statelessClient } from "@/lib/supabase/admin";

// Change password. Requires the current password, unless the user just came
// through a valid reset link (signed recovery cookie for this same user).
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!(await allow("password-user", user.id, LIMITS.passwordChangePerUser))) {
    return json({ error: "Too many attempts. Wait 15 minutes and try again." }, { status: 429 });
  }
  const body = await readJson(req);
  const store = await cookies();
  const viaRecovery = recoveryValidFor(store.get(RECOVERY_COOKIE)?.value, user.id);

  if (!viaRecovery) {
    const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const { error } = await statelessClient().auth.signInWithPassword({ email: user.email, password: current });
    if (error) return json({ error: "Your current password isn't right.", field: "currentPassword" }, { status: 400 });
  }
  const pwError = validatePassword(body.newPassword, { email: user.email, displayName: user.displayName });
  if (pwError) return json({ error: pwError, field: "newPassword" }, { status: 400 });

  const { error } = await adminClient().auth.admin.updateUserById(user.id, { password: body.newPassword as string });
  if (error) {
    console.error("[password]", error.code, error.message);
    return json({ error: error.code === "same_password" ? "That's your current password. Pick a new one." : "Couldn't change your password. Try again." }, { status: 400 });
  }
  store.delete(RECOVERY_COOKIE);
  return json({ ok: true });
}
