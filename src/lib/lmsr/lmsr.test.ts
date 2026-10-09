import { describe, expect, it } from "vitest";
import { cost, costToMove, prices, quoteLmsrBuy, quoteLmsrSell, sharesForSpend } from "./lmsr";

const L = { maxTradeUsd: 2000 };

describe("LMSR math", () => {
  it("starts every outcome at equal odds and prices always sum to 1", () => {
    expect(prices([0, 0], 1000)).toEqual([0.5, 0.5]);
    const p9 = prices(Array(9).fill(0), 1000);
    for (const p of p9) expect(p).toBeCloseTo(1 / 9);
    const moved = prices([500, 0, 120, -40], 300);
    expect(moved.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("sharesForSpend is the exact inverse of the cost function", () => {
    const q = [120, 40, 0];
    for (const spend of [1, 50, 750, 1999]) {
      const d = sharesForSpend(q, 1000, 1, spend);
      expect(cost([q[0], q[1] + d, q[2]], 1000) - cost(q, 1000)).toBeCloseTo(spend, 8);
    }
  });

  it("is numerically stable with large share counts", () => {
    const p = prices([200_000, 0], 1000);
    expect(p[0]).toBeLessThanOrEqual(1);
    expect(Number.isFinite(cost([200_000, 0], 1000))).toBe(true);
  });

  it("costToMove matches the default-liquidity table in the README", () => {
    expect(costToMove(1000, 0.5, 0.6)).toBeCloseTo(223.1, 1);
    expect(costToMove(1000, 0.5, 0.75)).toBeCloseTo(693.1, 1);
    expect(costToMove(1000, 0.5, 0.9)).toBeCloseTo(1609.4, 1);
  });
});

describe("quoteLmsrBuy", () => {
  it("buying raises the price and never costs more than asked", () => {
    const q = quoteLmsrBuy([0, 0], 1000, 0, 100, L);
    if (!q.ok) throw new Error();
    expect(q.total).toBeLessThanOrEqual(100);
    expect(q.total).toBeGreaterThan(99.9);
    expect(q.bestPrice).toBeCloseTo(0.5);
    expect(q.worstPrice).toBeGreaterThan(0.5);
    expect(q.avgPrice).toBeGreaterThan(0.5);
    expect(q.avgPrice).toBeLessThan(q.worstPrice);
    expect(q.payoutIfWin).toBe(Math.floor(q.shares * 100) / 100);
  });

  it("caps at maxTradeUsd", () => {
    const q = quoteLmsrBuy([0, 0], 1000, 0, 5000, L);
    expect(q.ok && q.total).toBeLessThanOrEqual(2000);
    expect(q.ok && q.capReason).toBe("size");
  });

  it("rejects zero", () => {
    expect(quoteLmsrBuy([0, 0], 1000, 0, 0, L).ok).toBe(false);
  });
});

describe("quoteLmsrSell", () => {
  it("buy then sell the same shares returns (almost) the same money, never more", () => {
    const b = quoteLmsrBuy([0, 0, 0], 1000, 2, 300, L);
    if (!b.ok) throw new Error();
    const q2 = [0, 0, b.shares];
    const s = quoteLmsrSell(q2, 1000, 2, b.shares, L);
    if (!s.ok) throw new Error();
    expect(s.total).toBeLessThanOrEqual(b.total);
    expect(b.total - s.total).toBeLessThan(0.03);
    expect(s.worstPrice).toBeCloseTo(1 / 3, 3);
  });

  it("caps proceeds at maxTradeUsd by selling fewer shares", () => {
    const s = quoteLmsrSell([20000, 0], 1000, 0, 20000, L);
    if (!s.ok) throw new Error();
    expect(s.total).toBeLessThanOrEqual(2000);
    expect(s.shares).toBeLessThan(20000);
    expect(s.capReason).toBe("size");
  });

  it("rejects selling nothing", () => {
    expect(quoteLmsrSell([0, 0], 1000, 0, 0, L).ok).toBe(false);
  });
});
