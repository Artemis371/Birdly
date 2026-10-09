import type { NextRequest } from "next/server";
import { json } from "@/lib/api-response";
import { readJson, requireAdmin } from "@/lib/auth/guard";
import { env } from "@/lib/env";
import { adminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Supabase "ban" = can't sign in or refresh a session. ~100 years.
const BAN_FOREVER = "876000h";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/users/[id]">) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return json({ error: "Unknown user." }, { status: 400 });
  const { action } = await readJson(req);
  const db = adminClient();

  if (action === "reset") {
    const { data, error } = await db.rpc("admin_reset_balance", { p_admin_id: admin.id, p_user_id: id });
    if (error) return json({ error: "Couldn't reset that balance." }, { status: 500 });
    return json({ ok: true, cash: Number(data) });
  }

  if (action === "deactivate" || action === "reactivate") {
    if (id === admin.id) return json({ error: "You can't deactivate yourself." }, { status: 400 });
    const active = action === "reactivate";
    const { error: banError } = await db.auth.admin.updateUserById(id, { ban_duration: active ? "none" : BAN_FOREVER });
    if (banError) return json({ error: "Couldn't update that account's sign-in access." }, { status: 500 });
    const { error } = await db.rpc("admin_set_active", { p_admin_id: admin.id, p_user_id: id, p_active: active });
    if (error) return json({ error: "Couldn't update that account." }, { status: 500 });
    return json({ ok: true });
  }

  if (action === "recovery_link") {
    // A password-reset link the admin can send by text. Works without any
    // email setup. Expires per Supabase's OTP expiry (default 1 hour).
    const { data: u } = await db.auth.admin.getUserById(id);
    if (!u.user?.email) return json({ error: "Unknown user." }, { status: 404 });
    const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email: u.user.email });
    const hash = data?.properties?.hashed_token;
    if (error || !hash) return json({ error: "Couldn't generate a reset link." }, { status: 500 });
    const link = `${env.siteUrl()}/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=recovery&next=/reset-password`;
    return json({ ok: true, link });
  }

  return json({ error: "Unknown action." }, { status: 400 });
}
