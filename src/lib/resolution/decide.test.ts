import { describe, expect, it } from "vitest";
import clob5050 from "@/lib/polymarket/__fixtures__/clob-market-5050.json";
import clobResolved from "@/lib/polymarket/__fixtures__/clob-market-resolved.json";
import gamma5050 from "@/lib/polymarket/__fixtures__/gamma-market-5050.json";
import gammaResolved from "@/lib/polymarket/__fixtures__/gamma-market-resolved.json";
import { parseClobMarket, parseMarket } from "@/lib/polymarket/parse";
import type { ClobMarket, Market } from "@/lib/polymarket/types";
import { decideResolution } from "./decide";

// Real responses captured from Polymarket on 2026-10-09.
const g = parseMarket(gammaResolved)!;
const c = parseClobMarket(clobResolved)!;
const g50 = parseMarket(gamma5050)!;
const c50 = parseClobMarket(clob5050)!;
const tokens = (m: Market) => m.outcomes.map((o) => o.tokenId);

describe("decideResolution on real resolved markets", () => {
  it("pays $1 to the winner and $0 to the loser", () => {
    const d = decideResolution(tokens(g), g, c);
    expect(d.action).toBe("pay");
    if (d.action === "pay") {
      const winner = c.tokens.find((t) => t.winner)!.tokenId;
      expect(d.payouts[winner]).toBe(1);
      expect(Object.values(d.payouts).sort()).toEqual([0, 1]);
    }
  });

  it("pays $0.50 per share on both sides of a real 50/50", () => {
    const d = decideResolution(tokens(g50), g50, c50);
    expect(d).toMatchObject({ action: "pay", note: "Resolved 50/50." });
    if (d.action === "pay") expect(Object.values(d.payouts)).toEqual([0.5, 0.5]);
  });
});

describe("decideResolution waits when anything is off", () => {
  const with_ = (m: Market, patch: Partial<Market>): Market => ({ ...m, ...patch });
  const prices = (m: Market, ps: (number | null)[]): Market => ({ ...m, outcomes: m.outcomes.map((o, i) => ({ ...o, price: ps[i] })) });
  const clobPrices = (cm: ClobMarket, ps: number[], winners: boolean[]): ClobMarket => ({
    ...cm,
    tokens: cm.tokens.map((t, i) => ({ ...t, price: ps[i], winner: winners[i] })),
  });

  it("market missing from Polymarket", () => {
    expect(decideResolution(tokens(g), null, c)).toMatchObject({ action: "wait", closed: false });
  });

  it("still open, or past end date but not closed", () => {
    expect(decideResolution(tokens(g), with_(g, { closed: false, endDate: "2099-01-01T00:00:00Z" }), c)).toMatchObject({ action: "wait", reason: "Still open." });
    expect(decideResolution(tokens(g), with_(g, { closed: false, endDate: "2020-01-01T00:00:00Z" }), c).action).toBe("wait");
  });

  it.each(["proposed", "disputed", "requested"] as const)("closed but %s", (s) => {
    expect(decideResolution(tokens(g), with_(g, { umaResolutionStatus: s }), c)).toMatchObject({ action: "wait", closed: true });
  });

  it("closed with no status", () => {
    expect(decideResolution(tokens(g), with_(g, { umaResolutionStatus: null }), c).action).toBe("wait");
  });

  it("resolved but prices still trading-like (do not sum to 1)", () => {
    expect(decideResolution(tokens(g), prices(g, [0.63, 0.35]), c).action).toBe("wait");
  });

  it("resolved but a price is missing", () => {
    expect(decideResolution(tokens(g), prices(g, [1, null]), c).action).toBe("wait");
  });

  it("resolved with unusual final prices that do sum to 1", () => {
    const d = decideResolution(tokens(g), prices(g, [0.7, 0.3]), c);
    expect(d).toMatchObject({ action: "wait" });
  });

  it("snaps float noise like 0.99999998 to clean values", () => {
    const winnerIdx = g.outcomes.findIndex((o) => o.price === 1);
    const ps = g.outcomes.map((_, i) => (i === winnerIdx ? 0.99999998 : 0.00000002));
    const d = decideResolution(tokens(g), prices(g, ps), c);
    expect(d.action).toBe("pay");
  });

  it("CLOB unavailable or still open", () => {
    expect(decideResolution(tokens(g), g, null).action).toBe("wait");
    expect(decideResolution(tokens(g), g, { ...c, closed: false }).action).toBe("wait");
  });

  it("Gamma and CLOB disagree on prices", () => {
    const flipped = clobPrices(c, c.tokens.map((t) => 1 - (t.price ?? 0)), c.tokens.map((t) => !t.winner));
    expect(decideResolution(tokens(g), g, flipped)).toMatchObject({ action: "wait", reason: expect.stringMatching(/disagree/) });
  });

  it("CLOB prices agree but the winner flag is missing", () => {
    const noWinner = clobPrices(c, c.tokens.map((t) => t.price ?? 0), [false, false]);
    expect(decideResolution(tokens(g), g, noWinner)).toMatchObject({ action: "wait", reason: expect.stringMatching(/winner/) });
  });

  it("our stored outcomes don't match Polymarket's", () => {
    expect(decideResolution(["999", "888"], g, c).action).toBe("wait");
    expect(decideResolution([g.outcomes[0].tokenId], g, c).action).toBe("wait");
  });
});
