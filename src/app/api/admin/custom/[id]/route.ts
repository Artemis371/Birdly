import type { NextRequest } from "next/server";
import { json } from "@/lib/api-response";
import { readJson, requireAdmin } from "@/lib/auth/guard";
import { friendly, moveCustomMarket, saveCustomMarket } from "@/lib/custom/admin-actions";
import { getCustomById } from "@/lib/custom/markets";
import { adminClient } from "@/lib/supabase/admin";

// actions: save | publish | delete | resolve | cancel | add_outcome | move
export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/custom/[id]">) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await ctx.params;
  const m = await getCustomById(id);
  if (!m) return json({ error: "That market wasn't found." }, { status: 404 });
  const body = await readJson(req);
  const db = adminClient();

  // Moving between categories is allowed at any time, even on closed markets.
  if (body.action === "move") {
    const categoryId = Number(body.categoryId);
    if (!Number.isInteger(categoryId) || categoryId <= 0) return json({ error: "Pick a category." }, { status: 400 });
    const r = await moveCustomMarket(admin.id, id, categoryId);
    return r.ok ? json(r) : json(r, { status: 400 });
  }

  const closed = m.status === "resolved" || m.status === "cancelled";
  if (closed && body.action !== "resolve" && body.action !== "cancel") {
    return json({ error: `This market is already ${m.status} and can't be changed.` }, { status: 400 });
  }

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
  if (body.action === "add_outcome") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const start = Number(body.startPrice);
    if (!name || name.length > 60) return json({ error: "Give the new outcome a name (up to 60 characters)." }, { status: 400 });
    if (!(start >= 0.01 && start <= 0.5)) return json({ error: "Starting chance must be between 1% and 50%." }, { status: 400 });
    const rules = typeof body.rules === "string" && body.rules.trim() && body.rules.trim() !== m.rules ? body.rules.trim().slice(0, 4000) : null;
    const { data, error } = await db.rpc("admin_add_custom_outcome", { p_admin_id: admin.id, p_id: id, p_name: name, p_start_price: start, p_rules: rules });
    if (error) return json({ error: friendly(error.message) }, { status: 400 });
    return json({ ok: true, outcomes: data.outcomes, prices: data.prices });
  }
  if (body.action === "cancel") {
    // Refunds everyone what they paid in, net of sales. Idempotent in SQL.
    if (body.confirmTitle !== m.title) return json({ error: "Confirmation didn't match. Reload and try again." }, { status: 400 });
    const { data, error } = await db.rpc("cancel_custom_market", { p_admin_id: admin.id, p_id: id });
    if (error) return json({ error: friendly(error.message) }, { status: 400 });
    return json({ ok: true, alreadyCancelled: !!data.already_cancelled, refundedUsers: Number(data.refunded_users), totalRefunded: Number(data.total_refunded) });
  }
  return json({ error: "Unknown action." }, { status: 400 });
}
