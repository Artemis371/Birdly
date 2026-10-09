import { describe, expect, it, vi } from "vitest";
import multiEvent from "@/lib/polymarket/__fixtures__/gamma-event-multi.json";
import { parseEvent } from "@/lib/polymarket/parse";
import type { OrderBook, PolyEvent } from "@/lib/polymarket/types";
import { signToken } from "@/lib/signing";
import { executeQuote, getQuote, type TradeDeps } from "./execute";

const ev = parseEvent(multiEvent)!; // real event, captured live
const m = ev.markets[0];
const yes = m.outcomes[0].tokenId;
const base = { slug: ev.slug, conditionId: m.conditionId, outcomeIndex: 0 as const };

function book(ask: number, bid = ask - 0.01, size = 100_000): OrderBook {
  return { tokenId: yes, conditionId: m.conditionId, bids: [{ price: bid, size }], asks: [{ price: ask, size }], bestBid: bid, bestAsk: ask, tickSize: 0.001, minOrderSize: 5, timestamp: 0 };
}

function deps(over: Partial<TradeDeps> = {}) {
  const used = new Set<string>();
  let n = 0;
  const d: TradeDeps = {
    secret: "test-secret",
    now: () => 1_000_000,
    getEvent: async () => ({ data: ev as PolyEvent, stale: false }),
    getFreshBook: async () => book(0.4),
    sharesOwned: async () => 0,
    claimQuote: async (jti) => (used.has(jti) ? false : (used.add(jti), true)),
    newId: () => `q${n++}`,
    executeTrade: vi.fn(async (a) => ({ ok: true as const, cash: 10000 - a.amount, shares: a.shares, tradeId: 1 })),
    ...over,
  };
  return d as TradeDeps & { executeTrade: ReturnType<typeof vi.fn> };
}

describe("quote then execute", () => {
  it("quotes from the fresh book and executes at the fresh price", async () => {
    let ask = 0.4;
    const d = deps({ getFreshBook: async () => book(ask) });
    const q = await getQuote("u1", { ...base, side: "buy", amount: 100 }, d);
    if (!q.ok) throw new Error(q.error);
    expect(q.quote.avgPrice).toBe(0.4);

    ask = 0.41; // small move, within the 2c tolerance
    const r = await executeQuote("u1", q.token, d);
    expect(r.ok).toBe(true);
    const call = d.executeTrade.mock.calls[0][0];
    expect(call.price).toBe(0.41); // fresh price, not the quoted 0.40
    expect(call.amount).toBeLessThanOrEqual(100);
    expect(call.market.outcome_name).toBe("Yes");
    expect(call.tokenId).toBe(yes);
  });

  it("rejects execution when the price moved more than the tolerance, with a fresh quote", async () => {
    let ask = 0.4;
    const d = deps({ getFreshBook: async () => book(ask) });
    const q = await getQuote("u1", { ...base, side: "buy", amount: 100 }, d);
    if (!q.ok) throw new Error();
    ask = 0.45;
    const r = await executeQuote("u1", q.token, d);
    expect(r).toMatchObject({ ok: false, code: "price_moved", status: 409 });
    expect(r.ok ? null : r.quote?.quote.avgPrice).toBe(0.45);
    expect(d.executeTrade).not.toHaveBeenCalled();
  });

  it("a better price than quoted still executes", async () => {
    let ask = 0.4;
    const d = deps({ getFreshBook: async () => book(ask) });
    const q = await getQuote("u1", { ...base, side: "buy", amount: 100 }, d);
    if (!q.ok) throw new Error();
    ask = 0.3;
    expect((await executeQuote("u1", q.token, d)).ok).toBe(true);
  });

  it("ignores any price the client tries to send: only a signed token is accepted", async () => {
    const d = deps();
    const forged = signToken({ ...base, side: "buy", amount: 100, u: "u1", avg: 0.01, jti: "x" }, "quote", "wrong-secret", 60, 1_000_000);
    expect(await executeQuote("u1", forged, d)).toMatchObject({ ok: false, code: "quote_expired" });
    expect(await executeQuote("u1", "garbage", d)).toMatchObject({ ok: false });
    expect(d.executeTrade).not.toHaveBeenCalled();
  });

  it("rejects an expired quote", async () => {
    let t = 1_000_000;
    const d = deps({ now: () => t });
    const q = await getQuote("u1", { ...base, side: "buy", amount: 100 }, d);
    if (!q.ok) throw new Error();
    t += 61_000;
    expect(await executeQuote("u1", q.token, d)).toMatchObject({ ok: false, code: "quote_expired" });
  });

  it("rejects someone else's quote", async () => {
    const d = deps();
    const q = await getQuote("u1", { ...base, side: "buy", amount: 100 }, d);
    if (!q.ok) throw new Error();
    expect(await executeQuote("u2", q.token, d)).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("a quote can only be executed once (no double-submit)", async () => {
    const d = deps();
    const q = await getQuote("u1", { ...base, side: "buy", amount: 100 }, d);
    if (!q.ok) throw new Error();
    expect((await executeQuote("u1", q.token, d)).ok).toBe(true);
    expect(await executeQuote("u1", q.token, d)).toMatchObject({ ok: false, code: "quote_used" });
    expect(d.executeTrade).toHaveBeenCalledTimes(1);
  });

  it("blocks trading with no usable quote", async () => {
    expect(await getQuote("u1", { ...base, side: "buy", amount: 10 }, deps({ getFreshBook: async () => null }))).toMatchObject({ ok: false, code: "no_quote" });
    const empty = { ...book(0.4), asks: [], bestAsk: null };
    expect(await getQuote("u1", { ...base, side: "buy", amount: 10 }, deps({ getFreshBook: async () => empty }))).toMatchObject({ ok: false, code: "no_quote" });
  });

  it("blocks trading on stale market data", async () => {
    const d = deps({ getEvent: async () => ({ data: ev, stale: true }) });
    expect(await getQuote("u1", { ...base, side: "buy", amount: 10 }, d)).toMatchObject({ ok: false, code: "stale" });
  });

  it("blocks closed or proposed markets", async () => {
    const closed = { ...ev, markets: ev.markets.map((x) => ({ ...x, closed: true })) };
    expect(await getQuote("u1", { ...base, side: "buy", amount: 10 }, deps({ getEvent: async () => ({ data: closed, stale: false }) }))).toMatchObject({ code: "blocked" });
    const proposed = { ...ev, markets: ev.markets.map((x) => ({ ...x, umaResolutionStatus: "proposed" as const })) };
    expect(await getQuote("u1", { ...base, side: "buy", amount: 10 }, deps({ getEvent: async () => ({ data: proposed, stale: false }) }))).toMatchObject({ code: "blocked" });
  });

  it("caps sells at shares owned and refuses selling nothing", async () => {
    expect(await getQuote("u1", { ...base, side: "sell", amount: 10 }, deps())).toMatchObject({ ok: false, code: "nothing_to_sell" });
    const q = await getQuote("u1", { ...base, side: "sell", amount: 500 }, deps({ sharesOwned: async () => 12.5 }));
    expect(q.ok && q.quote.shares).toBe(12.5);
  });

  it("passes database refusals through as friendly errors", async () => {
    const d = deps({ executeTrade: vi.fn(async () => ({ ok: false as const, code: "insufficient_funds" })) });
    const q = await getQuote("u1", { ...base, side: "buy", amount: 100 }, d);
    if (!q.ok) throw new Error();
    expect(await executeQuote("u1", q.token, d)).toMatchObject({ ok: false, status: 409, error: "Not enough paper cash for that." });
  });

  it("rejects malformed requests", async () => {
    for (const bad of [
      { ...base, side: "buy" as const, amount: -1 },
      { ...base, side: "buy" as const, amount: Number.NaN },
      { ...base, conditionId: "not-hex", side: "buy" as const, amount: 1 },
      { ...base, outcomeIndex: 2 as 0, side: "buy" as const, amount: 1 },
    ]) {
      expect(await getQuote("u1", bad, deps())).toMatchObject({ ok: false, status: 400 });
    }
  });
});
