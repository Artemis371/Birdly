import { describe, expect, it } from "vitest";
import book from "./__fixtures__/book-live.json";
import clob5050 from "./__fixtures__/clob-market-5050.json";
import clobResolved from "./__fixtures__/clob-market-resolved.json";
import multiEvent from "./__fixtures__/gamma-event-multi.json";
import gamma5050 from "./__fixtures__/gamma-market-5050.json";
import gammaResolved from "./__fixtures__/gamma-market-resolved.json";
import history from "./__fixtures__/history-1h.json";
import { isoDate, parseBook, parseClobMarket, parseEvent, parseHistory, parseJsonArray, parseMarket } from "./parse";

// Fixtures are real responses captured 2026-10-09 (see __fixtures__/README.txt).

describe("parseBook (live fixture)", () => {
  const b = parseBook(book, "x");

  it("derives best bid as the highest bid and best ask as the lowest ask", () => {
    const rawBids = book.bids.map((l) => Number(l.price));
    const rawAsks = book.asks.map((l) => Number(l.price));
    expect(b.bestBid).toBe(Math.max(...rawBids));
    expect(b.bestAsk).toBe(Math.min(...rawAsks));
    expect(b.bestBid!).toBeLessThan(b.bestAsk!);
  });

  it("sorts levels best-first even though the API returns them best-last", () => {
    expect(Number(book.bids.at(-1)!.price)).toBe(b.bestBid);
    for (let i = 1; i < b.bids.length; i++) expect(b.bids[i].price).toBeLessThan(b.bids[i - 1].price);
    for (let i = 1; i < b.asks.length; i++) expect(b.asks[i].price).toBeGreaterThan(b.asks[i - 1].price);
  });

  it("keeps metadata", () => {
    expect(b.tokenId).toBe(book.asset_id);
    expect(b.conditionId).toBe(book.market);
    expect(b.tickSize).toBe(0.001);
    expect(b.timestamp).toBeGreaterThan(1_700_000_000_000);
  });

  it("handles an empty or error response", () => {
    const empty = parseBook({ error: "No orderbook exists for the requested token id" }, "t");
    expect(empty.bestBid).toBeNull();
    expect(empty.bestAsk).toBeNull();
  });
});

describe("parseEvent (live multi-outcome fixture)", () => {
  const e = parseEvent(multiEvent)!;

  it("parses the double-encoded outcome strings into aligned outcomes", () => {
    expect(e.markets.length).toBe(4);
    for (const m of e.markets) {
      expect(m.outcomes.map((o) => o.name)).toEqual(["Yes", "No"]);
      expect(m.outcomes[0].tokenId).toMatch(/^\d+$/);
      expect(m.label).not.toBe(m.question); // groupItemTitle = candidate name
    }
    expect(e.negRisk).toBe(true);
    expect(e.tags.map((t) => t.slug)).toContain("politics");
  });
});

describe("resolved markets (live fixtures)", () => {
  it("normal resolution: Gamma 1/0 + resolved, CLOB has exactly one winner", () => {
    const g = parseMarket(gammaResolved)!;
    expect(g.closed).toBe(true);
    expect(g.umaResolutionStatus).toBe("resolved");
    expect(g.outcomes.map((o) => o.price).sort()).toEqual([0, 1]);
    expect(g.closedTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const c = parseClobMarket(clobResolved)!;
    expect(c.tokens.filter((t) => t.winner)).toHaveLength(1);
  });

  it("50/50 resolution: prices 0.5/0.5 and NO winner flag on either token", () => {
    const g = parseMarket(gamma5050)!;
    expect(g.umaResolutionStatus).toBe("resolved");
    expect(g.outcomes.map((o) => o.price)).toEqual([0.5, 0.5]);
    expect(g.outcomes.map((o) => o.name)).toEqual(["Packers", "Cowboys"]);
    const c = parseClobMarket(clob5050)!;
    expect(c.tokens.every((t) => !t.winner)).toBe(true);
    expect(c.tokens.map((t) => t.price)).toEqual([0.5, 0.5]);
  });
});

describe("parseHistory", () => {
  it("parses the live { history: [...] } shape", () => {
    const pts = parseHistory(history);
    expect(pts.length).toBeGreaterThan(10);
    for (let i = 1; i < pts.length; i++) expect(pts[i].t).toBeGreaterThan(pts[i - 1].t);
  });
  it("accepts a bare array and drops duplicate timestamps", () => {
    expect(parseHistory([{ t: 2, p: 0.2 }, { t: 1, p: 0.1 }, { t: 2, p: 0.3 }])).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("parseJsonArray handles strings, arrays, junk", () => {
    expect(parseJsonArray('["Yes","No"]')).toEqual(["Yes", "No"]);
    expect(parseJsonArray(["a"])).toEqual(["a"]);
    expect(parseJsonArray("nope")).toEqual([]);
    expect(parseJsonArray(null)).toEqual([]);
  });
  it("isoDate normalizes Postgres-style timestamps seen on closedTime", () => {
    expect(isoDate("2026-10-08 18:38:29+00")).toBe("2026-10-08T18:38:29.000Z");
    expect(isoDate("2026-10-08 16:51:36.423771+00")).toBe("2026-10-08T16:51:36.423Z");
    expect(isoDate("2026-10-09T00:15:00Z")).toBe("2026-10-09T00:15:00.000Z");
    expect(isoDate("garbage")).toBeNull();
  });
  it("skips undeployed markets with no token ids", () => {
    expect(parseMarket({ id: "1", conditionId: "0x1", clobTokenIds: null })).toBeNull();
  });
});
