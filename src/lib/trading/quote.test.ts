import { describe, expect, it } from "vitest";
import liveBook from "@/lib/polymarket/__fixtures__/book-live.json";
import { parseBook } from "@/lib/polymarket/parse";
import type { OrderBook } from "@/lib/polymarket/types";
import { centsDown, centsUp, priceMovedTooMuch, quoteBuy, quoteSell, type QuoteLimits } from "./quote";

const limits: QuoteLimits = { maxTradeUsd: 2000, maxSlippage: 0.05, minPrice: 0.001, maxPrice: 0.999 };

function book(bids: [number, number][], asks: [number, number][]): OrderBook {
  return {
    tokenId: "t",
    conditionId: null,
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
    bestBid: bids.length ? Math.max(...bids.map((b) => b[0])) : null,
    bestAsk: asks.length ? Math.min(...asks.map((a) => a[0])) : null,
    tickSize: 0.01,
    minOrderSize: 5,
    timestamp: null,
  };
}

describe("quoteBuy", () => {
  it("fills entirely at the best ask when the top level is deep enough", () => {
    const q = quoteBuy(book([[0.4, 1000]], [[0.42, 1000], [0.5, 1000]]), 42, limits);
    expect(q.ok && q.shares).toBe(100);
    expect(q.ok && q.total).toBe(42);
    expect(q.ok && q.avgPrice).toBeCloseTo(0.42);
    expect(q.ok && q.payoutIfWin).toBe(100);
    expect(q.ok && q.capped).toBe(false);
  });

  it("never fills at midpoint or bid", () => {
    const q = quoteBuy(book([[0.3, 1000]], [[0.5, 1000]]), 10, limits);
    expect(q.ok && q.avgPrice).toBe(0.5);
  });

  it("walks multiple levels and reports a volume-weighted average", () => {
    // 10 @ 0.40 = $4, then 15 @ 0.42 = $6.30 -> $10.30 for 25 shares
    const q = quoteBuy(book([], [[0.42, 100], [0.4, 10]]), 10.3, limits);
    expect(q.ok && q.shares).toBeCloseTo(25, 3);
    expect(q.ok && q.total).toBe(10.3);
    expect(q.ok && q.worstPrice).toBe(0.42);
    expect(q.ok && q.avgPrice).toBeCloseTo(10.3 / 25, 6);
  });

  it("stops at the slippage band and flags a depth cap", () => {
    // best 0.40, band up to 0.45; the 0.46 level must not be touched
    const q = quoteBuy(book([], [[0.4, 10], [0.45, 10], [0.46, 1_000_000]]), 500, limits);
    expect(q.ok && q.shares).toBe(20);
    expect(q.ok && q.total).toBe(8.5);
    expect(q.ok && q.capped).toBe(true);
    expect(q.ok && q.capReason).toBe("depth");
  });

  it("caps a single trade at maxTradeUsd", () => {
    const q = quoteBuy(book([], [[0.5, 1_000_000]]), 9000, limits);
    expect(q.ok && q.total).toBe(2000);
    expect(q.ok && q.shares).toBe(4000);
    expect(q.ok && q.capReason).toBe("size");
  });

  it("never charges more than the requested amount after cent rounding", () => {
    const q = quoteBuy(book([], [[0.333, 1_000_000]]), 100, limits);
    expect(q.ok && q.total).toBeLessThanOrEqual(100);
    expect(q.ok && q.total).toBeGreaterThan(99.9);
  });

  it("blocks when there is no ask", () => {
    expect(quoteBuy(book([[0.5, 10]], []), 10, limits)).toEqual({ ok: false, reason: "no_quote" });
  });

  it("blocks when the book is pinned at the extremes", () => {
    expect(quoteBuy(book([], [[0.9995, 10]]), 10, limits)).toEqual({ ok: false, reason: "price_out_of_range" });
  });

  it("rejects zero or negative amounts", () => {
    expect(quoteBuy(book([], [[0.5, 10]]), 0, limits).ok).toBe(false);
    expect(quoteBuy(book([], [[0.5, 10]]), -5, limits).ok).toBe(false);
  });

  it("works on the real captured book", () => {
    const b = parseBook(liveBook, "x");
    const q = quoteBuy(b, 100, limits);
    expect(q.ok).toBe(true);
    if (q.ok) {
      expect(q.bestPrice).toBe(b.bestAsk);
      expect(q.avgPrice).toBeGreaterThanOrEqual(b.bestAsk!);
      expect(q.worstPrice).toBeLessThanOrEqual(b.bestAsk! + 0.05 + 1e-9);
      expect(q.total).toBeLessThanOrEqual(100);
    }
  });
});

describe("quoteSell", () => {
  it("fills at the best bid", () => {
    const q = quoteSell(book([[0.6, 1000], [0.5, 1000]], [[0.7, 10]]), 100, limits);
    expect(q.ok && q.total).toBe(60);
    expect(q.ok && q.avgPrice).toBe(0.6);
    expect(q.ok && q.capped).toBe(false);
  });

  it("partial sell walks bids downward", () => {
    // 50 @ 0.60 + 30 @ 0.58 = 30 + 17.4 = 47.4
    const q = quoteSell(book([[0.58, 100], [0.6, 50]], []), 80, limits);
    expect(q.ok && q.shares).toBe(80);
    expect(q.ok && q.total).toBe(47.4);
  });

  it("stops at the slippage band and leaves the rest unsold", () => {
    const q = quoteSell(book([[0.6, 10], [0.5, 1000]], []), 100, limits);
    expect(q.ok && q.shares).toBe(10);
    expect(q.ok && q.capReason).toBe("depth");
  });

  it("caps proceeds at maxTradeUsd", () => {
    const q = quoteSell(book([[0.5, 1_000_000]], []), 10_000, limits);
    expect(q.ok && q.total).toBe(2000);
    expect(q.ok && q.shares).toBe(4000);
    expect(q.ok && q.capReason).toBe("size");
  });

  it("rounds proceeds down to the cent", () => {
    const q = quoteSell(book([[0.333, 1000]], []), 1, limits);
    expect(q.ok && q.total).toBe(0.33);
  });

  it("blocks with no bids or nothing to sell", () => {
    expect(quoteSell(book([], [[0.5, 1]]), 10, limits)).toEqual({ ok: false, reason: "no_quote" });
    expect(quoteSell(book([[0.5, 1]], []), 0, limits)).toEqual({ ok: false, reason: "nothing_to_sell" });
  });
});

describe("helpers", () => {
  it("cent rounding", () => {
    expect(centsUp(1.001)).toBe(1.01);
    expect(centsUp(1.0)).toBe(1);
    expect(centsDown(1.009)).toBe(1);
  });
  it("only adverse moves beyond tolerance count", () => {
    expect(priceMovedTooMuch(0.4, 0.43, "buy", 0.02)).toBe(true);
    expect(priceMovedTooMuch(0.4, 0.42, "buy", 0.02)).toBe(false);
    expect(priceMovedTooMuch(0.4, 0.3, "buy", 0.02)).toBe(false);
    expect(priceMovedTooMuch(0.6, 0.57, "sell", 0.02)).toBe(true);
    expect(priceMovedTooMuch(0.6, 0.7, "sell", 0.02)).toBe(false);
  });
});
