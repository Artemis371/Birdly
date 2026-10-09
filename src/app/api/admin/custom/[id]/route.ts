import type { NextRequest } from "next/server";
import { json } from "@/lib/api-response";
import { readJson, requireAdmin } from "@/lib/auth/guard";
import { friendly, saveCustomMarket } from "@/lib/custom/admin-actions";
import { getCustomById } from "@/lib/custom/markets";
import { adminClient } from "@/lib/supabase/admin";

// actions: save | publish | delete | resolve
export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/custom/[id]">) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await ctx.params;
  const m = await getCustomById(id);
  if (!m) return json({ error: "That market wasn't found." }, { status: 404 });
  const body = await readJson(req);
  const db = adminClient();

  if (body.action === "save" || body.action === "publish") {
    const r = await saveCustomMarket(admin.id, id, body, body.action === "publish");
    return r.ok ? json(r) : json(r, { status: 400 });
  }
  if (body.action === "delete") {
    const { error } = await db.rpc("admin_delete_custom_draft", { p_admin_id: admin.id, p_id: id });
    return error ? json({ error: friendly(error.message) }, { status: 400 }) : json({ ok: true });
  }
  if (body.action === "resolve") {
    const winner = Number(body.winner);
    if (!Number.isInteger(winner) || winner < 0 || winner >= m.outcomes.length) return json({ error: "Pick one of the outcomes." }, { status: 400 });
    if (body.confirmTitle !== m.title) return json({ error: "Confirmation didn't match. Reload and try again." }, { status: 400 });
    const { data, error } = await db.rpc("resolve_custom_market", { p_admin_id: admin.id, p_id: id, p_winner: winner });
    if (error) return json({ error: friendly(error.message) }, { status: 400 });
    return json({ ok: true, alreadyResolved: !!data.already_resolved, paidPositions: Number(data.paid_positions), totalPaid: Number(data.total_paid) });
  }
  return json({ error: "Unknown action." }, { status: 400 });
}
