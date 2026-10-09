import { describe, expect, it } from "vitest";
import { fetchClobMarket, fetchGammaMarketsByCondition } from "@/lib/polymarket/api";
import { runResolution } from "@/lib/resolution/run";
import { cash, createAuthUser, freshDb } from "./db";

// LIVE end-to-end: real Polymarket APIs + the real SQL (in PGlite).
// Opt-in only (needs network):  LIVE=1 npx vitest run src/test/live-resolution.test.ts
const NORMAL = "0x91088f430d36e485afbeb4f556bf560f8318356d0b43542a8ee9b5d90372f651"; // Dota 2 game, resolved 1/0
const SPLIT = "0x0af48a189e649217f4c5af8184a22e3961500c63e97e9474d010a93350e0b4c7"; // Packers vs Cowboys tie, 50/50

describe.skipIf(!process.env.LIVE)("live resolution against real Polymarket", () => {
  it("pays a real normal resolution and a real 50/50, exactly once", async () => {
    const db = await freshDb();
    const alice = await createAuthUser(db, "a@example.com", "Alice");
    const gamma = await fetchGammaMarketsByCondition([NORMAL, SPLIT]);
    expect(gamma.size).toBe(2);

    // Seed positions in both real markets directly (trading them is closed).
    for (const cid of [NORMAL, SPLIT]) {
      const m = gamma.get(cid)!;
      await db.query(
        "insert into public.markets (condition_id, event_slug, event_title, question, label, outcomes) values ($1,'e','e',$2,$2,$3)",
        [cid, m.question, JSON.stringify(m.outcomes.map((o) => ({ name: o.name, token_id: o.tokenId })))],
      );
      for (const [i, o] of m.outcomes.entries()) {
        await db.query(
          "insert into public.positions (user_id, season_id, token_id, condition_id, outcome_index, outcome_name, shares, cost_basis) values ($1,1,$2,$3,$4,$5,100,50)",
          [alice, o.tokenId, cid, i, o.name],
        );
      }
    }

    const deps = {
      candidates: async () =>
        [NORMAL, SPLIT].map((cid) => ({ conditionId: cid, tokenIds: gamma.get(cid)!.outcomes.map((o) => o.tokenId) })),
      gammaMarkets: fetchGammaMarketsByCondition,
      clobMarket: fetchClobMarket,
      resolve: async (cid: string, payouts: Record<string, number>, note: string) => {
        const r = await db.query<{ r: { already_resolved: boolean; paid_positions: number; total_paid: string } }>(
          "select public.resolve_market($1, $2, $3) as r",
          [cid, JSON.stringify(payouts), note],
        );
        const x = r.rows[0].r;
        return { alreadyResolved: x.already_resolved, paidPositions: x.paid_positions, totalPaid: Number(x.total_paid) };
      },
      note: async (cid: string, reason: string, closed: boolean) => {
        await db.query("select public.note_resolution_check($1, $2, $3)", [cid, reason, closed]);
      },
    };

    const first = await runResolution(deps);
    console.log("live run:", JSON.stringify(first));
    expect(first.errors).toEqual([]);
    expect(first.paid).toHaveLength(2);
    // Held 100 of each side in both markets: normal pays 100 + 0, 50/50 pays 50 + 50.
    expect(await cash(db, alice)).toBe(10000 + 100 + 100);

    const second = await runResolution(deps);
    expect(second.paid).toHaveLength(0);
    expect(await cash(db, alice)).toBe(10200);
  }, 60_000);
});
