import { describe, expect, it, vi } from "vitest";
import clobResolved from "@/lib/polymarket/__fixtures__/clob-market-resolved.json";
import gammaResolved from "@/lib/polymarket/__fixtures__/gamma-market-resolved.json";
import { parseClobMarket, parseMarket } from "@/lib/polymarket/parse";
import type { Market } from "@/lib/polymarket/types";
import { runResolution, type ResolutionDeps } from "./run";

const g = parseMarket(gammaResolved)!;
const c = parseClobMarket(clobResolved)!;
const resolvedCand = { conditionId: g.conditionId, tokenIds: g.outcomes.map((o) => o.tokenId) };
const openMarket: Market = { ...g, conditionId: "0xopen", closed: false, umaResolutionStatus: null, endDate: "2099-01-01T00:00:00Z" };
const openCand = { conditionId: "0xopen", tokenIds: openMarket.outcomes.map((o) => o.tokenId) };

function deps(over: Partial<ResolutionDeps> = {}) {
  return {
    candidates: async () => [resolvedCand, openCand],
    gammaMarkets: async () => new Map([[g.conditionId, g], ["0xopen", openMarket]]),
    clobMarket: vi.fn(async () => c),
    resolve: vi.fn(async () => ({ alreadyResolved: false, paidPositions: 2, totalPaid: 100 })),
    note: vi.fn(async () => {}),
    ...over,
  } as ResolutionDeps & { clobMarket: ReturnType<typeof vi.fn>; resolve: ReturnType<typeof vi.fn>; note: ReturnType<typeof vi.fn> };
}

describe("runResolution", () => {
  it("pays resolved markets and notes the reason for the rest", async () => {
    const d = deps();
    const s = await runResolution(d);
    expect(s.checked).toBe(2);
    expect(s.paid).toEqual([{ conditionId: g.conditionId, paidPositions: 2, totalPaid: 100 }]);
    expect(d.resolve).toHaveBeenCalledTimes(1);
    expect(d.note).toHaveBeenCalledWith("0xopen", "Still open.", false);
  });

  it("only asks the CLOB about markets Gamma says are resolved", async () => {
    const d = deps();
    await runResolution(d);
    expect(d.clobMarket).toHaveBeenCalledTimes(1);
    expect(d.clobMarket).toHaveBeenCalledWith(g.conditionId);
  });

  it("an already-resolved market (paid by another run) isn't reported as paid again", async () => {
    const d = deps({ resolve: vi.fn(async () => ({ alreadyResolved: true, paidPositions: 0, totalPaid: 0 })) });
    expect((await runResolution(d)).paid).toEqual([]);
  });

  it("writes nothing if Polymarket is unreachable", async () => {
    const d = deps({ gammaMarkets: async () => Promise.reject(new Error("fetch failed")) });
    const s = await runResolution(d);
    expect(s.errors).toHaveLength(2);
    expect(d.resolve).not.toHaveBeenCalled();
    expect(d.note).not.toHaveBeenCalled();
  });

  it("one failing market doesn't stop the others", async () => {
    const d = deps({ clobMarket: vi.fn(async () => Promise.reject(new Error("503"))) });
    const s = await runResolution(d);
    expect(s.errors).toEqual([{ conditionId: g.conditionId, error: expect.stringContaining("503") }]);
    expect(d.note).toHaveBeenCalledWith("0xopen", "Still open.", false);
  });

  it("stops at the deadline and says so", async () => {
    let t = 0;
    const d = deps({ now: () => (t += 1000) });
    const s = await runResolution(d, { deadlineMs: 1500 });
    expect(s.timedOut).toBe(true);
    expect(s.checked).toBeLessThan(2);
  });

  it("does nothing when nobody holds unresolved markets", async () => {
    const d = deps({ candidates: async () => [] });
    const s = await runResolution(d);
    expect(s.checked).toBe(0);
    expect(d.resolve).not.toHaveBeenCalled();
  });
});
