import "server-only";
import { prices as lmsrPrices } from "@/lib/lmsr/lmsr";
import type { ChartRange, PricePoint } from "@/lib/polymarket/types";
import { adminClient } from "@/lib/supabase/admin";
import { type CustomMarket, customConditionId, parseCustomToken } from "./types";

type Row = {
  id: string;
  slug: string;
  title: string;
  description: string;
  rules: string;
  outcomes: string[];
  q: number[];
  liquidity: string | number;
  end_at: string;
  status: CustomMarket["status"];
  winning_index: number | null;
  published_at: string | null;
  resolved_at: string | null;
  cancelled_at: string | null;
  notify_sent_at: string | null;
  category_id?: number | null;
};

// "*" rather than a column list so this keeps working whether or not
// migration 0007 (category_id) has been run yet.
const COLS = "*";

async function volumes(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const { data } = await adminClient()
    .from("trades")
    .select("condition_id, amount, kind")
    .in("condition_id", ids.map(customConditionId))
    .in("kind", ["buy", "sell"])
    .limit(10000);
  for (const t of data ?? []) {
    const id = String(t.condition_id).slice("custom:".length);
    out.set(id, (out.get(id) ?? 0) + Number(t.amount));
  }
  return out;
}

function toMarket(r: Row, volume: number | undefined): CustomMarket {
  const q = (r.q ?? []).map(Number);
  const b = Number(r.liquidity);
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    rules: r.rules,
    outcomes: r.outcomes,
    q,
    liquidity: b,
    endAt: r.end_at,
    status: r.status,
    winningIndex: r.winning_index,
    publishedAt: r.published_at,
    resolvedAt: r.resolved_at,
    cancelledAt: r.cancelled_at,
    notifySentAt: r.notify_sent_at,
    prices: lmsrPrices(q, b),
    ended: Date.parse(r.end_at) <= Date.now(),
    hasTrades: (volume ?? 0) > 0,
    volume: volume ?? 0,
    categoryId: r.category_id ?? null,
  };
}

async function withVolumes(rows: Row[]): Promise<CustomMarket[]> {
  const v = await volumes(rows.map((r) => r.id));
  return rows.map((r) => toMarket(r, v.get(r.id)));
}

// Published markets for one category tab: open first (ending soonest), then
// resolved. categoryId null = every category (only before migration 0007).
export async function listPublishedCustom(categoryId: number | null): Promise<CustomMarket[]> {
  let query = adminClient().from("custom_markets").select(COLS).neq("status", "draft");
  if (categoryId !== null) query = query.eq("category_id", categoryId);
  const { data, error } = await query.order("end_at");
  if (error) throw new Error(error.message);
  const ms = await withVolumes((data ?? []) as Row[]);
  const closed = (m: CustomMarket) => Number(m.status === "resolved" || m.status === "cancelled");
  return ms.sort((a, b) => closed(a) - closed(b));
}

export async function listAllCustom(): Promise<CustomMarket[]> {
  const { data, error } = await adminClient().from("custom_markets").select(COLS).order("created_at");
  if (error) throw new Error(error.message);
  return withVolumes((data ?? []) as Row[]);
}

export async function getCustomBySlug(slug: string): Promise<CustomMarket | null> {
  const { data } = await adminClient().from("custom_markets").select(COLS).eq("slug", slug).maybeSingle();
  return data ? (await withVolumes([data as Row]))[0] : null;
}

export async function getCustomById(id: string): Promise<CustomMarket | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data } = await adminClient().from("custom_markets").select(COLS).eq("id", id).maybeSingle();
  return data ? (await withVolumes([data as Row]))[0] : null;
}

const RANGE_SECONDS: Record<ChartRange, number | null> = { "1H": 3600, "1D": 86400, "1W": 7 * 86400, "1M": 30 * 86400, ALL: null };

// Chart history for one outcome: a point at every trade, carried forward to now.
export async function customHistory(m: CustomMarket, index: number, range: ChartRange): Promise<PricePoint[]> {
  const db = adminClient();
  const span = RANGE_SECONDS[range];
  const since = span ? new Date(Date.now() - span * 1000).toISOString() : null;
  let query = db.from("custom_price_points").select("at, prices").eq("market_id", m.id).order("at").limit(5000);
  if (since) query = query.gte("at", since);
  const { data } = await query;
  const pts: PricePoint[] = (data ?? []).map((r) => ({ t: Math.floor(Date.parse(r.at) / 1000), p: Number((r.prices as number[])[index]) }));
  // Carry the price that was in effect at the start of the window.
  if (since && (!pts.length || pts[0].t > Date.parse(since) / 1000)) {
    const { data: prev } = await db.from("custom_price_points").select("prices").eq("market_id", m.id).lt("at", since).order("at", { ascending: false }).limit(1);
    const p = prev?.[0] ? Number((prev[0].prices as number[])[index]) : null;
    if (p !== null) pts.unshift({ t: Math.floor(Date.parse(since) / 1000), p });
  }
  const end = (m.status === "resolved" || m.status === "cancelled") && m.resolvedAt ? Math.floor(Date.parse(m.resolvedAt) / 1000) : Math.floor(Date.now() / 1000);
  if (pts.length) pts.push({ t: Math.max(end, pts[pts.length - 1].t + 1), p: m.prices[index] ?? pts[pts.length - 1].p });
  return pts.filter((pt, i) => i === 0 || pt.t > pts[i - 1].t);
}

// Current LMSR price per custom token (for valuing positions).
export async function customTokenPrices(tokenIds: string[]): Promise<Record<string, number>> {
  const parsed = tokenIds.map(parseCustomToken).filter((x): x is { marketId: string; index: number } => !!x);
  const ids = [...new Set(parsed.map((p) => p.marketId))];
  if (!ids.length) return {};
  const { data } = await adminClient().from("custom_markets").select("id, q, liquidity, status, winning_index").in("id", ids);
  const out: Record<string, number> = {};
  for (const r of data ?? []) {
    const ps =
      r.status === "cancelled"
        ? (r.q as number[]).map(() => 0) // refunded; any leftover shares are worth nothing
        : r.status === "resolved" && r.winning_index !== null
          ? (r.q as number[]).map((_, i) => (i === r.winning_index ? 1 : 0))
          : lmsrPrices((r.q as number[]).map(Number), Number(r.liquidity));
    ps.forEach((p, i) => (out[`custom:${r.id}:${i}`] = p));
  }
  return out;
}

export async function countCustomDrafts(): Promise<number> {
  const { count } = await adminClient().from("custom_markets").select("id", { count: "exact", head: true }).eq("status", "draft");
  return count ?? 0;
}
