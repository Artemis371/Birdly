import { describe, expect, it } from "vitest";
import { valuePositions } from "./portfolio";

const row = (shares: number, cost: number) => ({ token_id: "t", condition_id: "c", outcome_index: 0, outcome_name: "Yes", shares, cost_basis: cost, markets: null });

describe("valuePositions", () => {
  it("values at the live best bid and computes unrealized P&L", () => {
    const [p] = valuePositions([row(100, 40)], { t: 0.55 });
    expect(p.value).toBe(55);
    expect(p.pnl).toBe(15);
    expect(p.pnlPct).toBeCloseTo(0.375);
    expect(p.avgCost).toBeCloseTo(0.4);
  });
  it("a position with no bid is worth 0 right now", () => {
    const [p] = valuePositions([row(100, 40)], {});
    expect(p.bid).toBeNull();
    expect(p.value).toBe(0);
    expect(p.pnl).toBe(-40);
  });
  it("rounds value down to the cent", () => {
    const [p] = valuePositions([row(3, 1)], { t: 0.333 });
    expect(p.value).toBe(0.99);
  });
});
