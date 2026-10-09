import "server-only";
import { trading } from "@/config/site";
import { isCustomToken } from "@/lib/custom/types";
import { markPrices } from "@/lib/valuation";
import { adminClient } from "@/lib/supabase/admin";
import { currentSeasonId } from "@/lib/trading/deps";

export type PositionView = {
  tokenId: string;
  conditionId: string;
  eventSlug: string;
  eventTitle: string;
  label: string;
  image: string | null;
  outcomeIndex: number;
  outcomeName: string;
  shares: number;
  costBasis: number;
  avgCost: number;
  bid: number | null; // live best bid (Polymarket) or LMSR price (custom)
  isCustom: boolean;
  value: number; // shares * best bid (0 if no bid)
  pnl: number;
  pnlPct: number | null;
};

export type TradeView = {
  id: number;
  kind: "buy" | "sell" | "payout" | "refund";
  outcomeName: string;
  label: string;
  eventSlug: string;
  isCustom: boolean;
  shares: number;
  price: number;
  amount: number;
  createdAt: string;
};

export type Portfolio = {
  cash: number;
  positions: PositionView[];
  positionsValue: number;
  total: number;
  pnl: number;
  pnlPct: number;
  pricesStale: boolean;
  trades: TradeView[];
  history: { day: string; total: number }[];
};

type MarketRow = { event_slug: string; event_title: string; label: string; image: string | null };

// Mark-to-market at the current real best bid: what you'd actually get selling now.
export function valuePositions(
  rows: { token_id: string; condition_id: string; outcome_index: number; outcome_name: string; shares: number | string; cost_basis: number | string; markets: MarketRow | null }[],
  marks: Record<string, number | null>,
): PositionView[] {
  return rows.map((r) => {
    const shares = Number(r.shares);
    const costBasis = Number(r.cost_basis);
    const bid = marks[r.token_id] ?? null;
    const value = Math.floor(shares * (bid ?? 0) * 100) / 100;
    const pnl = Math.round((value - costBasis) * 100) / 100;
    return {
      tokenId: r.token_id,
      conditionId: r.condition_id,
      eventSlug: r.markets?.event_slug ?? "",
      eventTitle: r.markets?.event_title ?? "",
      label: r.markets?.label ?? "",
      image: r.markets?.image ?? null,
      outcomeIndex: r.outcome_index,
      outcomeName: r.outcome_name,
      shares,
      costBasis,
      avgCost: shares > 0 ? costBasis / shares : 0,
      bid,
      isCustom: isCustomToken(r.token_id),
      value,
      pnl,
      pnlPct: costBasis > 0 ? pnl / costBasis : null,
    };
  });
}

export async function loadPortfolio(userId: string): Promise<Portfolio> {
  const db = adminClient();
  const season = await currentSeasonId();
  const [bal, pos, trades, snaps] = await Promise.all([
    db.from("balances").select("cash").eq("user_id", userId).eq("season_id", season).maybeSingle(),
    db
      .from("positions")
      .select("token_id, condition_id, outcome_index, outcome_name, shares, cost_basis, markets(event_slug, event_title, label, image)")
      .eq("user_id", userId)
      .eq("season_id", season)
      .gt("shares", 0),
    db
      .from("trades")
      .select("id, kind, outcome_name, shares, price, amount, created_at, markets(label, event_slug, source)")
      .eq("user_id", userId)
      .eq("season_id", season)
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("account_snapshots").select("day, total").eq("user_id", userId).eq("season_id", season).order("day"),
  ]);

  const cash = Number(bal.data?.cash ?? 0);
  const rows = (pos.data ?? []) as unknown as Parameters<typeof valuePositions>[0];
  const { prices: marks, stale: pricesStale } = rows.length ? await markPrices(rows.map((r) => r.token_id)) : { prices: {}, stale: false };
  const positions = valuePositions(rows, marks).sort((a, b) => b.value - a.value);
  const positionsValue = Math.round(positions.reduce((s, p) => s + p.value, 0) * 100) / 100;
  const total = Math.round((cash + positionsValue) * 100) / 100;

  // Lazily record today's snapshot for the account-value chart (only with live prices).
  if (!pricesStale) {
    const { error } = await db.rpc("record_snapshot", { p_user_id: userId, p_positions_value: positionsValue });
    if (error) console.error("[snapshot]", error.message);
  }

  const today = new Date().toISOString().slice(0, 10);
  const history = (snaps.data ?? []).map((s) => ({ day: s.day as string, total: Number(s.total) })).filter((s) => s.day !== today);
  history.push({ day: today, total });

  return {
    cash,
    positions,
    positionsValue,
    total,
    pnl: Math.round((total - trading.startingBalance) * 100) / 100,
    pnlPct: (total - trading.startingBalance) / trading.startingBalance,
    pricesStale,
    trades: ((trades.data ?? []) as unknown as Array<{ id: number; kind: TradeView["kind"]; outcome_name: string; shares: string; price: string; amount: string; created_at: string; markets: { label: string; event_slug: string; source: string } | null }>).map((t) => ({
      id: t.id,
      kind: t.kind,
      outcomeName: t.outcome_name,
      label: t.markets?.label ?? "",
      eventSlug: t.markets?.event_slug ?? "",
      isCustom: t.markets?.source === "custom",
      shares: Number(t.shares),
      price: Number(t.price),
      amount: Number(t.amount),
      createdAt: t.created_at,
    })),
    history,
  };
}
