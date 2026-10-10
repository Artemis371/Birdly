import "server-only";
import { cache } from "react";
import { adminClient } from "@/lib/supabase/admin";
import { currentSeasonId } from "@/lib/trading/deps";
import { markPrices } from "@/lib/valuation";

// THE account value calculation. The top bar, the leaderboard and the
// portfolio page all go through valueAccount() with prices from markPrices(),
// so the numbers match to the cent (see account-value.test.ts).
//
//   positions = sum over open positions of floor(shares * sell price, to the cent)
//   total     = cash + positions

export type AccountValue = { cash: number; positionsValue: number; total: number; openPositions: number };
export type AccountSummary = AccountValue & { stale: boolean; asOf: number | null; computedAt: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

// What one position would sell for right now. Never rounds in the user's favor.
export function positionValue(shares: number, price: number | null | undefined): number {
  return Math.floor(shares * (price ?? 0) * 100) / 100;
}

export function valueAccount(cash: number, positions: { token_id: string; shares: number | string }[], prices: Record<string, number | null>): AccountValue {
  let sum = 0;
  let open = 0;
  for (const p of positions) {
    const shares = Number(p.shares);
    if (!(shares > 0)) continue;
    sum += positionValue(shares, prices[p.token_id]);
    open++;
  }
  const positionsValue = round2(sum);
  return { cash: round2(cash), positionsValue, total: round2(cash + positionsValue), openPositions: open };
}

// One user's account value for the top bar. Cash and shares are read fresh
// from the database every time; only Polymarket bids are cached (cacheTtl.accountPrices
// in config, see valuation.ts). Memoized per request so the top bar and page share it.
export const getAccountSummary = cache(async (userId: string): Promise<AccountSummary> => {
  const db = adminClient();
  const season = await currentSeasonId();
  const [bal, pos] = await Promise.all([
    db.from("balances").select("cash").eq("user_id", userId).eq("season_id", season).maybeSingle(),
    db.from("positions").select("token_id, shares").eq("user_id", userId).eq("season_id", season).gt("shares", 0),
  ]);
  if (bal.error || pos.error) throw new Error(bal.error?.message ?? pos.error?.message);
  const rows = (pos.data ?? []) as { token_id: string; shares: string }[];
  const marks = rows.length ? await markPrices(rows.map((r) => r.token_id)) : { prices: {}, stale: false, asOf: null };
  return { ...valueAccount(Number(bal.data?.cash ?? 0), rows, marks.prices), stale: marks.stale, asOf: marks.asOf, computedAt: Date.now() };
});
