import { describe, expect, it, vi } from "vitest";
import { prices } from "@/lib/lmsr/lmsr";
import { signToken } from "@/lib/signing";
import { executeCustomQuote, getCustomQuote, type CustomTradeDeps } from "./trade";
import type { CustomMarket } from "./types";

function market(over: Partial<CustomMarket> = {}): CustomMarket {
  const q = over.q ?? [0, 0];
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "liam-garage-flake",
    title: "Will Liam add more flake?",
    description: "",
    rules: "",
    outcomes: ["Yes", "No"],
    q,
    liquidity: 1000,
    endAt: "2099-01-01T00:00:00Z",
    status: "open",
    winningIndex: null,
    publishedAt: "2026-10-09T00:00:00Z",
    resolvedAt: null,
    notifySentAt: null,
    prices: prices(q, 1000),
    ended: false,
    hasTrades: false,
    volume: 0,
    ...over,
  };
}

function deps(over: Partial<CustomTradeDeps> = {}) {
  const used = new Set<string>();
  let n = 0;
  return {
    secret: "s",
    now: () => 1_000_000,
    newId: () => `j${n++}`,
    claimQuote: async (j: string) => (used.has(j) ? false : (used.add(j), true)),
    getMarket: async () => market(),
    sharesOwned: async () => 0,
    execute: vi.fn(async (a) => ({ ok: true as const, cash: 9900, shares: 190, total: a.amount, avg: 0.526, prices: [0.55, 0.45] })),
    ...over,
  } as CustomTradeDeps & { execute: ReturnType<typeof vi.fn> };
}

const req = { slug: "liam-garage-flake", outcomeIndex: 0, side: "buy" as const, amount: 100 };

describe("custom market trades", () => {
  it("quotes from the LMSR and executes with the quoted average as the in-database limit", async () => {
    const d = deps();
    const q = await getCustomQuote("u1", req, d);
    if (!q.ok) throw new Error(q.error);
    expect(q.quote.bestPrice).toBeCloseTo(0.5);
    expect(q.quote.worstPrice).toBeGreaterThan(0.5);
    const r = await executeCustomQuote("u1", q.token, d);
    expect(r.ok).toBe(true);
    expect(d.execute.mock.calls[0][0]).toMatchObject({ userId: "u1", index: 0, side: "buy", amount: 100, refAvg: q.quote.avgPrice });
  });

  it("price moved inside the transaction: returns a fresh quote, no trade", async () => {
    const d = deps({ execute: vi.fn(async () => ({ ok: false as const, code: "price_moved" })) });
    const q = await getCustomQuote("u1", req, d);
    if (!q.ok) throw new Error();
    const r = await executeCustomQuote("u1", q.token, d);
    expect(r).toMatchObject({ ok: false, code: "price_moved" });
    expect(r.ok ? null : r.quote?.token).toBeTruthy();
  });

  it("single-use, owner-only, unforgeable, expiring quotes", async () => {
    let t = 1_000_000;
    const d = deps({ now: () => t });
    const q = await getCustomQuote("u1", req, d);
    if (!q.ok) throw new Error();
    expect(await executeCustomQuote("u2", q.token, d)).toMatchObject({ code: "forbidden" });
    expect((await executeCustomQuote("u1", q.token, d)).ok).toBe(true);
    expect(await executeCustomQuote("u1", q.token, d)).toMatchObject({ code: "quote_used" });
    const forged = signToken({ m: market().id, s: req.slug, i: 0, side: "buy", amount: 100, u: "u1", avg: 0.01, jti: "x" }, "custom-quote", "wrong", 60, t);
    expect(await executeCustomQuote("u1", forged, d)).toMatchObject({ code: "quote_expired" });
    const q2 = await getCustomQuote("u1", req, d);
    if (!q2.ok) throw new Error();
    t += 61_000;
    expect(await executeCustomQuote("u1", q2.token, d)).toMatchObject({ code: "quote_expired" });
    expect(d.execute).toHaveBeenCalledTimes(1);
  });

  it("blocks drafts, ended and resolved markets", async () => {
    expect(await getCustomQuote("u1", req, deps({ getMarket: async () => market({ status: "draft" }) }))).toMatchObject({ code: "not_found" });
    expect(await getCustomQuote("u1", req, deps({ getMarket: async () => market({ ended: true }) }))).toMatchObject({ code: "market_ended" });
    expect(await getCustomQuote("u1", req, deps({ getMarket: async () => market({ status: "resolved" }) }))).toMatchObject({ code: "market_resolved" });
  });

  it("market ends between quote and execute: refused", async () => {
    let ended = false;
    const d = deps({ getMarket: async () => market({ ended }) });
    const q = await getCustomQuote("u1", req, d);
    if (!q.ok) throw new Error();
    ended = true;
    expect(await executeCustomQuote("u1", q.token, d)).toMatchObject({ code: "market_ended" });
  });

  it("sells are capped at shares owned; selling nothing is refused", async () => {
    expect(await getCustomQuote("u1", { ...req, side: "sell", amount: 5 }, deps())).toMatchObject({ code: "nothing_to_sell" });
    const q = await getCustomQuote("u1", { ...req, side: "sell", amount: 999 }, deps({ getMarket: async () => market({ q: [100, 0] }), sharesOwned: async () => 40 }));
    expect(q.ok && q.quote.shares).toBe(40);
  });

  it("rejects malformed requests", async () => {
    for (const bad of [{ ...req, amount: -1 }, { ...req, outcomeIndex: 1.5 }, { ...req, slug: "../x" }, { ...req, side: "short" as "buy" }]) {
      expect(await getCustomQuote("u1", bad, deps())).toMatchObject({ status: 400 });
    }
  });
});
