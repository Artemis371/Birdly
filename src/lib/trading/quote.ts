import { trading } from "@/config/site";
import type { BookLevel, OrderBook } from "@/lib/polymarket/types";

// Pure order-book walking. Every share fills at a real resting price on the
// real book (asks for buys, bids for sells), never midpoint or last trade.
// Rounding never favors the user: shares round down, buy cost rounds up to the
// cent, sell proceeds round down to the cent.

export type QuoteLimits = {
  maxTradeUsd: number;
  maxSlippage: number;
  minPrice: number;
  maxPrice: number;
};

export const defaultLimits: QuoteLimits = {
  maxTradeUsd: trading.maxTradeUsd,
  maxSlippage: trading.maxSlippage,
  minPrice: trading.minPrice,
  maxPrice: trading.maxPrice,
};

export type Fill = { price: number; shares: number };

export type Quote =
  | {
      ok: true;
      side: "buy" | "sell";
      shares: number;
      // Dollars paid (buy) or received (sell), in whole cents.
      total: number;
      avgPrice: number;
      bestPrice: number;
      worstPrice: number;
      // Buys: what the shares pay if this outcome wins.
      payoutIfWin: number;
      // True when the request was cut down by the depth/slippage/size caps.
      capped: boolean;
      capReason: "size" | "depth" | null;
      fills: Fill[];
    }
  | { ok: false; reason: QuoteError };

export type QuoteError =
  | "no_quote" // empty side of the book
  | "price_out_of_range" // book is pinned at ~0 or ~1, effectively decided
  | "amount_too_small"
  | "nothing_to_sell";

const SHARE_STEP = 1e-4;

function floorTo(x: number, step: number): number {
  return Math.floor(x / step + 1e-9) * step;
}
export function roundShares(x: number): number {
  return Number(floorTo(x, SHARE_STEP).toFixed(4));
}
export function centsUp(x: number): number {
  return Math.ceil(x * 100 - 1e-9) / 100;
}
export function centsDown(x: number): number {
  return Math.floor(x * 100 + 1e-9) / 100;
}

function sum(fills: Fill[]): { shares: number; notional: number } {
  let shares = 0;
  let notional = 0;
  for (const f of fills) {
    shares += f.shares;
    notional += f.shares * f.price;
  }
  return { shares, notional };
}

// Buy by dollar amount: walk asks from best upward.
export function quoteBuy(book: OrderBook, usd: number, limits: QuoteLimits = defaultLimits): Quote {
  const asks: BookLevel[] = [...book.asks].sort((a, b) => a.price - b.price);
  const best = asks[0]?.price;
  if (best === undefined) return { ok: false, reason: "no_quote" };
  if (best < limits.minPrice || best > limits.maxPrice) return { ok: false, reason: "price_out_of_range" };
  if (!(usd > 0)) return { ok: false, reason: "amount_too_small" };

  const budget = Math.min(usd, limits.maxTradeUsd);
  const priceCap = best + limits.maxSlippage + 1e-9;
  let remaining = budget;
  const fills: Fill[] = [];

  for (const level of asks) {
    if (level.price > priceCap || level.price > limits.maxPrice) break;
    const take = roundShares(Math.min(level.size, remaining / level.price));
    if (take <= 0) break;
    fills.push({ price: level.price, shares: take });
    remaining -= take * level.price;
    if (take < level.size) break; // budget used up inside this level
  }
  if (fills.length === 0) return { ok: false, reason: "amount_too_small" };

  // Rounding cost up to the cent must never push the total past the budget.
  const last = fills[fills.length - 1];
  while (centsUp(sum(fills).notional) > budget + 1e-9 && last.shares > 0) {
    last.shares = roundShares(last.shares - SHARE_STEP * 10);
  }
  if (last.shares <= 0) fills.pop();
  if (fills.length === 0) return { ok: false, reason: "amount_too_small" };

  const { shares, notional } = sum(fills);
  const roundedShares = roundShares(shares);
  if (roundedShares <= 0) return { ok: false, reason: "amount_too_small" };
  const total = centsUp(notional);
  const sizeCapped = usd > limits.maxTradeUsd;
  // Money left over (beyond rounding dust) means we ran out of book within the slippage band.
  const depthCapped = remaining > 0.01;
  return {
    ok: true,
    side: "buy",
    shares: roundedShares,
    total,
    avgPrice: notional / shares,
    bestPrice: best,
    worstPrice: fills[fills.length - 1].price,
    payoutIfWin: centsDown(roundedShares),
    capped: sizeCapped || depthCapped,
    capReason: depthCapped ? "depth" : sizeCapped ? "size" : null,
    fills,
  };
}

// Sell a number of shares: walk bids from best downward.
export function quoteSell(book: OrderBook, sharesToSell: number, limits: QuoteLimits = defaultLimits): Quote {
  const bids: BookLevel[] = [...book.bids].sort((a, b) => b.price - a.price);
  const best = bids[0]?.price;
  if (!(sharesToSell > 0)) return { ok: false, reason: "nothing_to_sell" };
  if (best === undefined) return { ok: false, reason: "no_quote" };
  if (best < limits.minPrice || best > limits.maxPrice) return { ok: false, reason: "price_out_of_range" };

  const priceFloor = best - limits.maxSlippage - 1e-9;
  let remaining = roundShares(sharesToSell);
  let proceeds = 0;
  const fills: Fill[] = [];
  let capReason: "size" | "depth" | null = null;

  for (const level of bids) {
    if (remaining <= 0) break;
    if (level.price < priceFloor || level.price < limits.minPrice) {
      capReason = "depth";
      break;
    }
    let take = Math.min(level.size, remaining);
    const room = limits.maxTradeUsd - proceeds;
    if (take * level.price > room) {
      take = roundShares(room / level.price);
      capReason = "size";
    }
    take = roundShares(take);
    if (take <= 0) break;
    fills.push({ price: level.price, shares: take });
    proceeds += take * level.price;
    remaining = roundShares(remaining - take);
    if (capReason === "size") break;
  }
  if (remaining > 0 && capReason === null) capReason = "depth";
  if (fills.length === 0) return { ok: false, reason: "amount_too_small" };

  const { shares, notional } = sum(fills);
  return {
    ok: true,
    side: "sell",
    shares: roundShares(shares),
    total: centsDown(notional),
    avgPrice: notional / shares,
    bestPrice: best,
    worstPrice: fills[fills.length - 1].price,
    payoutIfWin: 0,
    capped: remaining > 0,
    capReason: remaining > 0 ? capReason : null,
    fills,
  };
}

// Has the executable price moved too far from what the user was shown?
export function priceMovedTooMuch(quotedAvg: number, freshAvg: number, side: "buy" | "sell", tolerance = trading.quoteTolerance): boolean {
  // Only adverse moves count; a better price than quoted is fine.
  return side === "buy" ? freshAvg - quotedAvg > tolerance + 1e-9 : quotedAvg - freshAvg > tolerance + 1e-9;
}
