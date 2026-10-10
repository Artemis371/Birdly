import "server-only";
import { valueAccount } from "@/lib/account-value";
import { markPrices } from "@/lib/valuation";
import { adminClient } from "@/lib/supabase/admin";
import { currentSeasonId } from "@/lib/trading/deps";

// Daily account-value snapshot for every active member, valued at live best
// bids. Skipped entirely if prices are stale, so we never record bad values.
export async function snapshotAll(): Promise<{ recorded: number; skipped: string | null }> {
  const db = adminClient();
  const season = await currentSeasonId();
  const [{ data: balances }, { data: positions }] = await Promise.all([
    db.from("balances").select("user_id, cash, profiles!inner(deactivated_at)").eq("season_id", season),
    db.from("positions").select("user_id, token_id, shares").eq("season_id", season).gt("shares", 0),
  ]);
  const tokens = [...new Set((positions ?? []).map((p) => p.token_id as string))];
  let bids: Record<string, number | null> = {};
  if (tokens.length) {
    const m = await markPrices(tokens);
    if (m.stale) return { recorded: 0, skipped: "prices stale" };
    bids = m.prices;
  }
  const byUser = new Map<string, { token_id: string; shares: string }[]>();
  for (const p of positions ?? []) byUser.set(p.user_id, [...(byUser.get(p.user_id) ?? []), p]);
  let recorded = 0;
  for (const b of (balances ?? []) as unknown as { user_id: string; cash: string; profiles: { deactivated_at: string | null } }[]) {
    if (b.profiles.deactivated_at) continue;
    const { positionsValue } = valueAccount(Number(b.cash), byUser.get(b.user_id) ?? [], bids);
    const { error } = await db.rpc("record_snapshot", { p_user_id: b.user_id, p_positions_value: positionsValue });
    if (error) console.error("[snapshot]", error.message);
    else recorded++;
  }
  return { recorded, skipped: null };
}
