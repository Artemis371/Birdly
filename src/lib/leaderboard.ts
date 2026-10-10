import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { currentSeasonId } from "@/lib/trading/deps";
import { valueAccount } from "@/lib/account-value";
import { markPrices } from "@/lib/valuation";

export type LeaderRow = {
  rank: number;
  userId: string;
  displayName: string;
  cash: number;
  positionsValue: number;
  total: number;
  returnPct: number;
  openPositions: number;
};

// Ranked by total account value: cash + every open position marked at its
// current sell price (real best bid for Polymarket, LMSR price for Leahys).
export async function loadLeaderboard(): Promise<{ rows: LeaderRow[]; stale: boolean; asOf: number | null; startingBalance: number }> {
  const db = adminClient();
  const season = await currentSeasonId();
  const [{ data: seasonRow }, { data: balances }, { data: positions }] = await Promise.all([
    db.from("seasons").select("starting_balance").eq("id", season).single(),
    db.from("balances").select("user_id, cash, profiles!inner(display_name, deactivated_at)").eq("season_id", season),
    db.from("positions").select("user_id, token_id, shares").eq("season_id", season).gt("shares", 0),
  ]);
  const start = Number(seasonRow?.starting_balance ?? 10000);
  const { prices, stale, asOf } = await markPrices((positions ?? []).map((p) => p.token_id as string));

  const byUser = new Map<string, { token_id: string; shares: string }[]>();
  for (const p of positions ?? []) byUser.set(p.user_id, [...(byUser.get(p.user_id) ?? []), p]);
  type B = { user_id: string; cash: string; profiles: { display_name: string; deactivated_at: string | null } };
  const rows = ((balances ?? []) as unknown as B[])
    .filter((b) => !b.profiles.deactivated_at)
    .map((b) => {
      const v = valueAccount(Number(b.cash), byUser.get(b.user_id) ?? [], prices);
      return { userId: b.user_id, displayName: b.profiles.display_name, ...v, returnPct: (v.total - start) / start };
    });
  return { rows: rankRows(rows), stale, asOf, startingBalance: start };
}

// Sorted by total, highest first; ties share a rank (1, 2, 2, 4).
export function rankRows<T extends { total: number; displayName: string }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName));
  let rank = 0;
  let prev: number | null = null;
  return sorted.map((r, i) => {
    if (prev === null || r.total !== prev) rank = i + 1;
    prev = r.total;
    return { ...r, rank };
  });
}
