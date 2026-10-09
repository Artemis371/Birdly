import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { currentSeasonId } from "@/lib/trading/deps";
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
export async function loadLeaderboard(): Promise<{ rows: LeaderRow[]; stale: boolean; startingBalance: number }> {
  const db = adminClient();
  const season = await currentSeasonId();
  const [{ data: seasonRow }, { data: balances }, { data: positions }] = await Promise.all([
    db.from("seasons").select("starting_balance").eq("id", season).single(),
    db.from("balances").select("user_id, cash, profiles!inner(display_name, deactivated_at)").eq("season_id", season),
    db.from("positions").select("user_id, token_id, shares").eq("season_id", season).gt("shares", 0),
  ]);
  const start = Number(seasonRow?.starting_balance ?? 10000);
  const { prices, stale } = await markPrices((positions ?? []).map((p) => p.token_id as string));

  const value = new Map<string, { v: number; n: number }>();
  for (const p of positions ?? []) {
    const e = value.get(p.user_id) ?? { v: 0, n: 0 };
    e.v += Math.floor(Number(p.shares) * (prices[p.token_id] ?? 0) * 100) / 100;
    e.n++;
    value.set(p.user_id, e);
  }
  type B = { user_id: string; cash: string; profiles: { display_name: string; deactivated_at: string | null } };
  const rows = ((balances ?? []) as unknown as B[])
    .filter((b) => !b.profiles.deactivated_at)
    .map((b) => {
      const cash = Number(b.cash);
      const positionsValue = Math.round((value.get(b.user_id)?.v ?? 0) * 100) / 100;
      const total = Math.round((cash + positionsValue) * 100) / 100;
      return { userId: b.user_id, displayName: b.profiles.display_name, cash, positionsValue, total, returnPct: (total - start) / start, openPositions: value.get(b.user_id)?.n ?? 0 };
    });
  return { rows: rankRows(rows), stale, startingBalance: start };
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
