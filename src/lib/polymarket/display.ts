import type { Market, OrderBook } from "./types";

// The probability we SHOW (never used for fills): book midpoint when the spread
// is tight, otherwise fall back to Gamma's displayed price. Polymarket's own UI
// uses a similar midpoint-unless-wide-spread convention.
const WIDE_SPREAD = 0.1;

export function displayProb(book: OrderBook | undefined, fallback: number | null): number | null {
  if (book && book.bestBid !== null && book.bestAsk !== null && book.bestAsk - book.bestBid <= WIDE_SPREAD) {
    return (book.bestBid + book.bestAsk) / 2;
  }
  return fallback;
}

// Open markets in a sensible display order: mutually exclusive (neg-risk)
// events by Yes probability, everything else by 24h volume.
// active=false markets are Polymarket placeholders ("Person O", "Team H",
// "Other") that exist on-chain but aren't live yet (confirmed live); hide them.
export function orderMarkets(markets: Market[], negRisk: boolean): Market[] {
  const open = markets.filter((m) => m.active && !m.closed && m.outcomes.length >= 2);
  return [...open].sort((a, b) =>
    negRisk ? (b.outcomes[0].price ?? 0) - (a.outcomes[0].price ?? 0) : b.volume24hr - a.volume24hr || b.volume - a.volume,
  );
}

// Why a market can't be traded right now, or null if it can. Proposed/disputed
// markets are blocked too: the outcome is likely known, and fills there would
// be sniping a result that's already public.
export function marketBlockReason(m: Market): string | null {
  if (m.closed) return "This market has closed.";
  if (!m.active) return "This market isn't live yet.";
  if (!m.acceptingOrders || !m.enableOrderBook) return "This market isn't accepting orders right now.";
  if (m.umaResolutionStatus) return "A result has been proposed for this market, so trading is paused until it settles.";
  return null;
}

export type LiveSide = { bid: number | null; ask: number | null };
export type LiveMarket = { id: string; prob: number | null; yes: LiveSide; no: LiveSide };
export type LiveResponse = { fetchedAt: number; stale: boolean; markets: LiveMarket[] };

export function toLive(m: Market, books: Record<string, OrderBook>): LiveMarket {
  const yb = books[m.outcomes[0].tokenId];
  const nb = books[m.outcomes[1]?.tokenId];
  return {
    id: m.id,
    prob: displayProb(yb, m.outcomes[0].price),
    yes: { bid: yb?.bestBid ?? null, ask: yb?.bestAsk ?? null },
    no: { bid: nb?.bestBid ?? null, ask: nb?.bestAsk ?? null },
  };
}
