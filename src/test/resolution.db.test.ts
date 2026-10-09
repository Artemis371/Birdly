import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { cash, createAuthUser, freshDb, market, trade } from "./db";

// Runs the real migrations (0001 + 0002) in PGlite.

let db: PGlite;
let alice: string;
let bob: string;
const YES = "111";
const NO = "222";
const noSide = { ...market(), outcome_index: 1, outcome_name: "No" };

beforeEach(async () => {
  db = await freshDb();
  alice = await createAuthUser(db, "a@example.com", "Alice");
  bob = await createAuthUser(db, "b@example.com", "Bob");
});

async function resolve(payouts: Record<string, number>) {
  const r = await db.query<{ r: { already_resolved: boolean; paid_positions: number; total_paid: string } }>(
    "select public.resolve_market('0xabc', $1) as r",
    [JSON.stringify(payouts)],
  );
  return r.rows[0].r;
}

async function payoutRows() {
  return (await db.query<{ user_id: string; amount: string; price: string; shares: string }>("select user_id, amount, price, shares from public.trades where kind = 'payout' order by user_id")).rows;
}

describe("resolve_market", () => {
  it("winning shares pay $1, losing shares pay $0, and both are recorded", async () => {
    await trade(db, alice, "buy", 100, 40, 0.4); // Yes
    await trade(db, bob, "buy", 50, 30, 0.6, noSide); // No
    const r = await resolve({ [YES]: 1, [NO]: 0 });
    expect(r).toMatchObject({ already_resolved: false, paid_positions: 2 });
    expect(await cash(db, alice)).toBe(9960 + 100);
    expect(await cash(db, bob)).toBe(9970);
    const rows = await payoutRows();
    expect(rows).toHaveLength(2);
    const pos = (await db.query<{ shares: string; realized_pnl: string; user_id: string }>("select user_id, shares, realized_pnl from public.positions")).rows;
    for (const p of pos) expect(Number(p.shares)).toBe(0);
    expect(Number(pos.find((p) => p.user_id === alice)!.realized_pnl)).toBe(60);
    expect(Number(pos.find((p) => p.user_id === bob)!.realized_pnl)).toBe(-30);
  });

  it("a 50/50 pays $0.50 per share, rounded down to the cent", async () => {
    await trade(db, alice, "buy", 33.3333, 10, 0.3);
    await resolve({ [YES]: 0.5, [NO]: 0.5 });
    expect(await cash(db, alice)).toBe(9990 + 16.66);
  });

  it("double resolution never pays twice", async () => {
    await trade(db, alice, "buy", 100, 40, 0.4);
    await resolve({ [YES]: 1, [NO]: 0 });
    const again = await resolve({ [YES]: 1, [NO]: 0 });
    expect(again).toMatchObject({ already_resolved: true, paid_positions: 0 });
    // Even a different payout map on a second call changes nothing.
    await resolve({ [YES]: 0, [NO]: 1 });
    expect(await cash(db, alice)).toBe(10060);
    expect(await payoutRows()).toHaveLength(1);
  });

  it("partial sell before resolution only pays the remaining shares", async () => {
    await trade(db, alice, "buy", 100, 40, 0.4);
    await trade(db, alice, "sell", 60, 30, 0.5);
    await resolve({ [YES]: 1, [NO]: 0 });
    expect(await cash(db, alice)).toBe(10000 - 40 + 30 + 40);
  });

  it("users who fully sold get nothing more", async () => {
    await trade(db, alice, "buy", 100, 40, 0.4);
    await trade(db, alice, "sell", 100, 45, 0.45);
    const r = await resolve({ [YES]: 1, [NO]: 0 });
    expect(r.paid_positions).toBe(0);
    expect(await cash(db, alice)).toBe(10005);
  });

  it("trading is refused after resolution", async () => {
    await trade(db, alice, "buy", 100, 40, 0.4);
    await resolve({ [YES]: 1, [NO]: 0 });
    await expect(trade(db, bob, "buy", 10, 5, 0.5)).rejects.toThrow(/market_resolved/);
  });

  it("rejects invalid payout maps and pays nothing", async () => {
    await trade(db, alice, "buy", 100, 40, 0.4);
    await expect(resolve({ [YES]: 1 })).rejects.toThrow(/invalid_payouts/);
    await expect(resolve({ [YES]: 0.6, [NO]: 0.6 })).rejects.toThrow(/invalid_payouts/);
    await expect(resolve({ [YES]: 1.5, [NO]: -0.5 })).rejects.toThrow(/invalid_payouts/);
    await expect(resolve({ [YES]: 1, [NO]: 0, "333": 0 })).rejects.toThrow(/invalid_payouts/);
    expect(await cash(db, alice)).toBe(9960);
    expect(await payoutRows()).toHaveLength(0);
  });

  it("note_resolution_check records why a market is waiting, but never touches resolved ones", async () => {
    await trade(db, alice, "buy", 100, 40, 0.4);
    await db.query("select public.note_resolution_check('0xabc', 'Closed. A result was proposed.', true)");
    let m = (await db.query<{ resolution_note: string; polymarket_closed: boolean }>("select * from public.markets")).rows[0];
    expect(m).toMatchObject({ resolution_note: "Closed. A result was proposed.", polymarket_closed: true });
    await resolve({ [YES]: 1, [NO]: 0 });
    await db.query("select public.note_resolution_check('0xabc', 'should not overwrite', false)");
    m = (await db.query<{ resolution_note: string; polymarket_closed: boolean }>("select * from public.markets")).rows[0];
    expect(m.resolution_note).toBe("Resolved.");
  });

  it("signed-in members can't call the resolution functions", async () => {
    await db.exec("set role authenticated");
    try {
      await expect(db.exec(`select public.resolve_market('0xabc', '{"111":1,"222":0}')`)).rejects.toThrow(/permission denied/);
      await expect(db.exec(`select public.note_resolution_check('0xabc', 'x', true)`)).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });

  it("0002 is safe to re-run", async () => {
    await trade(db, alice, "buy", 100, 40, 0.4);
    const sql = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "0002_resolution.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql);
    await resolve({ [YES]: 1, [NO]: 0 });
    expect(await cash(db, alice)).toBe(10060);
  });
});
