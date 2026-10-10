import "server-only";
import { cache } from "react";
import { cacheTtl } from "@/config/site";
import { customTokenPrices } from "@/lib/custom/markets";
import { isCustomToken } from "@/lib/custom/types";
import { fetchBooks } from "@/lib/polymarket/api";
import { adminClient } from "@/lib/supabase/admin";

// What one share of each token is worth right now if sold:
//   Polymarket tokens: the real best bid (null if nobody is bidding)
//   custom tokens: the current LMSR price
//
// This is the only price source for account values (top bar, leaderboard,
// portfolio page, daily snapshots), so they always agree.
//
// Polymarket bids are cached per token for MARK_TTL_MS. Every page that shows
// an account value reads through this cache, so no matter how many pages
// people open, each token's book is fetched at most once per window (all
// missing tokens go in one POST /books). Cash and shares are never cached:
// they're read from the database on every request, so a trade, payout or
// refund shows up immediately. Custom (LMSR) prices are one cheap database
// read and change with every trade, so they're always read live.
//
// If Polymarket fails, the last known bid is used and the result is marked
// stale. On a fresh server instance with no last known bid, the price of the
// most recent Birdly trade in that token is used instead (also stale).

export const MARK_TTL_MS = cacheTtl.accountPrices * 1000;

export type Marks = {
  prices: Record<string, number | null>;
  stale: boolean;
  asOf: number | null; // when the oldest stale price was fetched (ms), null if fresh
};

type Entry = { price: number | null; fetchedAt: number; usedAt: number };
type Mark = { price: number | null; stale: boolean; fetchedAt: number | null };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();
const MAX_ENTRIES = 5_000;
const RECENT_MS = 10 * 60_000;
let clock: () => number = Date.now;

export function __resetMarkCache(now?: () => number) {
  store.clear();
  inflight.clear();
  clock = now ?? Date.now;
}

function remember(token: string, price: number | null, at: number) {
  if (store.size >= MAX_ENTRIES && !store.has(token)) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(token, { price, fetchedAt: at, usedAt: store.get(token)?.usedAt ?? at });
}

// Fetch books for the given tokens, sharing any request already in flight.
async function refresh(tokens: string[]): Promise<void> {
  const need = tokens.filter((t) => !inflight.has(t));
  if (need.length) {
    const p = fetchBooks(need).then((books) => {
      const at = clock();
      // A token missing from the response (resolved or unknown market) has no bid.
      for (const t of need) remember(t, books[t]?.bestBid ?? null, at);
    });
    for (const t of need) inflight.set(t, p);
    p.finally(() => need.forEach((t) => inflight.get(t) === p && inflight.delete(t))).catch(() => {});
  }
  const results = await Promise.allSettled([...new Set(tokens.map((t) => inflight.get(t)).filter(Boolean))]);
  for (const r of results) if (r.status === "rejected") console.error("[valuation] books:", r.reason instanceof Error ? r.reason.message : r.reason);
}

async function lastTradePrices(tokens: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    const { data } = await adminClient()
      .from("trades")
      .select("token_id, price, created_at")
      .in("token_id", tokens)
      .in("kind", ["buy", "sell"])
      .order("created_at", { ascending: false })
      .limit(500);
    for (const r of data ?? []) if (!(r.token_id in out)) out[r.token_id] = Number(r.price);
  } catch (err) {
    console.error("[valuation] last trade prices:", err instanceof Error ? err.message : err);
  }
  return out;
}

async function polymarketMarks(tokens: string[]): Promise<Record<string, Mark>> {
  const now = clock();
  const isExpired = (e: Entry | undefined) => !e || now - e.fetchedAt >= MARK_TTL_MS;
  const expired = tokens.filter((t) => isExpired(store.get(t)));
  if (expired.length) {
    // Also refresh other recently used tokens that are due, so the top bar,
    // leaderboard and portfolio rendering at the same moment share one call.
    const wanted = new Set(expired);
    for (const [t, e] of store) if (!inflight.has(t) && isExpired(e) && now - e.usedAt < RECENT_MS) wanted.add(t);
    await refresh([...wanted]);
  }
  for (const t of tokens) {
    const e = store.get(t);
    if (e) e.usedAt = now;
  }

  const out: Record<string, Mark> = {};
  const unknown: string[] = [];
  for (const t of tokens) {
    const e = store.get(t);
    if (!e) unknown.push(t);
    else out[t] = { price: e.price, stale: now - e.fetchedAt >= MARK_TTL_MS, fetchedAt: e.fetchedAt };
  }
  if (unknown.length) {
    const fallback = await lastTradePrices(unknown);
    for (const t of unknown) out[t] = { price: fallback[t] ?? null, stale: true, fetchedAt: null };
  }
  return out;
}

async function loadMarks(tokens: string[]): Promise<Record<string, Mark>> {
  const poly = tokens.filter((t) => !isCustomToken(t));
  const custom = tokens.filter(isCustomToken);
  const [p, c] = await Promise.all([
    poly.length ? polymarketMarks(poly) : {},
    custom.length ? customTokenPrices(custom) : ({} as Record<string, number>),
  ]);
  const out: Record<string, Mark> = { ...p };
  for (const t of custom) out[t] = { price: c[t] ?? null, stale: false, fetchedAt: null };
  return out;
}

// Per-request memo: the top bar and the page body render in the same request,
// so they must see the same price for a token even if the cache window rolls
// over between them. (Outside a React server render this is just a fresh map.)
const requestMarks = cache(() => new Map<string, Promise<Mark>>());

export async function markPrices(tokenIds: string[]): Promise<Marks> {
  const memo = requestMarks();
  const missing = [...new Set(tokenIds)].filter((t) => !memo.has(t));
  if (missing.length) {
    const batch = loadMarks(missing).catch((err): Record<string, Mark> => {
      console.error("[valuation]", err instanceof Error ? err.message : err);
      return {};
    });
    for (const t of missing) memo.set(t, batch.then((m) => m[t] ?? { price: null, stale: true, fetchedAt: null }));
  }
  const tokens = [...new Set(tokenIds)];
  const marks = await Promise.all(tokens.map((t) => memo.get(t) as Promise<Mark>));
  const prices: Record<string, number | null> = {};
  let stale = false;
  let asOf: number | null = null;
  tokens.forEach((t, i) => {
    const m = marks[i];
    prices[t] = m.price;
    if (m.stale) {
      stale = true;
      if (m.fetchedAt !== null) asOf = asOf === null ? m.fetchedAt : Math.min(asOf, m.fetchedAt);
    }
  });
  return { prices, stale, asOf };
}
