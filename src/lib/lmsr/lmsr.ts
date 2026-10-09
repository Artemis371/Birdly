// Logarithmic Market Scoring Rule (Hanson). An automated market maker that
// always quotes a price, so custom markets need no order book.
//
//   cost   C(q) = b * ln( sum_j exp(q_j / b) )
//   price  p_i  = exp(q_i / b) / sum_j exp(q_j / b)     (prices sum to 1)
//   buying d shares of i costs C(q + d*e_i) - C(q); selling returns C(q) - C(q - d*e_i)
//
// q_j = shares of outcome j sold so far, b = liquidity. Bigger b = prices move
// less per dollar. The house's worst-case subsidy is b * ln(number of outcomes).
// The same formulas run inside Postgres (execute_custom_trade) for execution;
// tests check both agree.

import type { Quote } from "@/lib/trading/quote";

const SHARE_STEP = 1e-4;

function logSumExp(q: number[], b: number): number {
  const m = Math.max(...q.map((x) => x / b));
  return m + Math.log(q.reduce((s, x) => s + Math.exp(x / b - m), 0));
}

export function cost(q: number[], b: number): number {
  return b * logSumExp(q, b);
}

export function prices(q: number[], b: number): number[] {
  const m = Math.max(...q.map((x) => x / b));
  const e = q.map((x) => Math.exp(x / b - m));
  const s = e.reduce((a, x) => a + x, 0);
  return e.map((x) => x / s);
}

// Shares of outcome i you get for spending exactly `spend` dollars (closed form).
export function sharesForSpend(q: number[], b: number, i: number, spend: number): number {
  const c = cost(q, b);
  // sum over j != i of exp(q_j/b), computed stably relative to (c + spend)/b
  const target = (c + spend) / b;
  const othersRel = q.reduce((s, x, j) => (j === i ? s : s + Math.exp(x / b - target)), 0);
  // exp((q_i + d)/b) = exp(target) * (1 - othersRel)
  return b * (target + Math.log(1 - othersRel)) - q[i];
}

const floorShares = (x: number) => Number((Math.floor(x / SHARE_STEP + 1e-9) * SHARE_STEP).toFixed(4));
const centsUp = (x: number) => Math.ceil(x * 100 - 1e-9) / 100;
const centsDown = (x: number) => Math.floor(x * 100 + 1e-9) / 100;

export type LmsrLimits = { maxTradeUsd: number };

// Buy outcome i for (up to) `usd` dollars. Shares round down, cost rounds up
// to the cent and never exceeds the amount asked for.
export function quoteLmsrBuy(q: number[], b: number, i: number, usd: number, limits: LmsrLimits): Quote {
  if (!(usd > 0)) return { ok: false, reason: "amount_too_small" };
  const budget = Math.min(usd, limits.maxTradeUsd);
  const before = prices(q, b)[i];
  let shares = floorShares(sharesForSpend(q, b, i, budget));
  let total = 0;
  for (let guard = 0; guard < 50; guard++) {
    if (shares <= 0) return { ok: false, reason: "amount_too_small" };
    const q2 = q.map((x, j) => (j === i ? x + shares : x));
    total = centsUp(cost(q2, b) - cost(q, b));
    if (total <= budget + 1e-9) break;
    shares = floorShares(shares - SHARE_STEP * 10);
  }
  if (total <= 0) return { ok: false, reason: "amount_too_small" };
  const after = prices(q.map((x, j) => (j === i ? x + shares : x)), b)[i];
  return {
    ok: true,
    side: "buy",
    shares,
    total,
    avgPrice: total / shares,
    bestPrice: before,
    worstPrice: after,
    payoutIfWin: centsDown(shares),
    capped: usd > limits.maxTradeUsd,
    capReason: usd > limits.maxTradeUsd ? "size" : null,
    fills: [],
  };
}

// Sell `shares` of outcome i. Proceeds round down to the cent. Proceeds are
// capped at maxTradeUsd by selling fewer shares.
export function quoteLmsrSell(q: number[], b: number, i: number, shares: number, limits: LmsrLimits): Quote {
  let d = floorShares(shares);
  if (!(d > 0)) return { ok: false, reason: "nothing_to_sell" };
  const before = prices(q, b)[i];
  const proceedsFor = (n: number) => cost(q, b) - cost(q.map((x, j) => (j === i ? x - n : x)), b);
  let capped = false;
  if (proceedsFor(d) > limits.maxTradeUsd) {
    // Binary search the share count that hits the cap.
    let lo = 0;
    let hi = d;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (proceedsFor(mid) > limits.maxTradeUsd) hi = mid;
      else lo = mid;
    }
    d = floorShares(lo);
    capped = true;
  }
  const total = centsDown(proceedsFor(d));
  if (d <= 0 || total <= 0) return { ok: false, reason: "amount_too_small" };
  const after = prices(q.map((x, j) => (j === i ? x - d : x)), b)[i];
  return {
    ok: true,
    side: "sell",
    shares: d,
    total,
    avgPrice: total / d,
    bestPrice: before,
    worstPrice: after,
    payoutIfWin: 0,
    capped,
    capReason: capped ? "size" : null,
    fills: [],
  };
}

// Dollars needed to move outcome i's price from p0 to p1 (useful for explaining b).
export function costToMove(b: number, p0: number, p1: number): number {
  return b * Math.log((1 - p0) / (1 - p1));
}
