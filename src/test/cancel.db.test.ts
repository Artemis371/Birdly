import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { cash, createAuthUser, freshDb } from "./db";

// Runs the real migrations (0001-0004) in PGlite.

let db: PGlite;
let admin: string;
let alice: string;
let bob: string;
let cara: string;
let id: string;

const t = (user: string, idx: number, side: "buy" | "sell", amount: number) =>
  db.query<{ r: { total: string; filled_shares: number } }>("select public.execute_custom_trade($1,$2,$3,$4,$5,null,0.02,2000) as r", [user, id, idx, side, amount]).then((r) => r.rows[0].r);
const cancel = () => db.query<{ r: { already_cancelled: boolean; refunded_users: number; total_refunded: string } }>("select public.cancel_custom_market($1,$2) as r", [admin, id]).then((r) => r.rows[0].r);

beforeEach(async () => {
  db = await freshDb();
  admin = await createAuthUser(db, "admin@example.com", "Admin");
  alice = await createAuthUser(db, "a@example.com", "Alice");
  bob = await createAuthUser(db, "b@example.com", "Bob");
  cara = await createAuthUser(db, "c@example.com", "Cara");
  id = (await db.query<{ id: string }>("select id from public.custom_markets where slug = 'beahy-other-leg'")).rows[0].id;
  await db.query(
    "select public.admin_save_custom_market($1,$2,'beahy-other-leg','When will Beahy fall over and break her other leg?','','Range containing the date.',array['Before Jan 1, 2027','Jan to Jun 2027','Jul to Dec 2027','Not by end of 2027'],'2099-01-01',1000,true)",
    [admin, id],
  );
});

describe("cancel_custom_market", () => {
  it("refunds each person exactly what they paid in, net of what they got back from selling", async () => {
    // Alice: two buys on different outcomes, then a partial sell.
    const a1 = Number((await t(alice, 0, "buy", 300)).total);
    const a2 = Number((await t(alice, 2, "buy", 120)).total);
    const a1Shares = Number((await db.query<{ shares: string }>("select shares from public.positions where user_id = $1 and token_id like '%:0'", [alice])).rows[0].shares);
    const aSell = Number((await t(alice, 0, "sell", a1Shares / 2)).total);
    // Bob: one buy. Cara: never traded.
    const b1 = Number((await t(bob, 3, "buy", 500)).total);

    const aliceBefore = await cash(db, alice);
    const bobBefore = await cash(db, bob);
    const r = await cancel();

    const aliceRefund = Math.round((a1 + a2 - aSell) * 100) / 100;
    expect(r).toMatchObject({ already_cancelled: false, refunded_users: 2 });
    expect(Number(r.total_refunded)).toBeCloseTo(aliceRefund + b1, 2);
    expect(await cash(db, alice)).toBeCloseTo(aliceBefore + aliceRefund, 2);
    expect(await cash(db, bob)).toBeCloseTo(bobBefore + b1, 2);
    // Net effect for each trader: back to exactly where they started.
    expect(await cash(db, alice)).toBe(10000);
    expect(await cash(db, bob)).toBe(10000);
    expect(await cash(db, cara)).toBe(10000);

    const open = await db.query("select 1 from public.positions where condition_id = $1 and shares > 0", [`custom:${id}`]);
    expect(open.rows).toHaveLength(0);
    const refunds = (await db.query<{ user_id: string; amount: string }>("select user_id, amount from public.trades where kind = 'refund'")).rows;
    expect(refunds).toHaveLength(2);
    const log = (await db.query<{ details: { total_refunded: number } }>("select details from public.admin_actions where action = 'cancel_custom_market'")).rows;
    expect(log).toHaveLength(1);
  });

  it("someone who already sold for more than they paid gets $0 (nobody is charged)", async () => {
    const a = Number((await t(alice, 1, "buy", 400)).total);
    await t(bob, 1, "buy", 1500); // pushes Alice's outcome up
    const shares = Number((await db.query<{ shares: string }>("select shares from public.positions where user_id = $1", [alice])).rows[0].shares);
    const sold = Number((await t(alice, 1, "sell", shares)).total);
    expect(sold).toBeGreaterThan(a);
    const before = await cash(db, alice);
    await cancel();
    expect(await cash(db, alice)).toBe(before);
    expect((await db.query("select 1 from public.trades where kind = 'refund' and user_id = $1", [alice])).rows).toHaveLength(0);
  });

  it("can't be run twice", async () => {
    await t(alice, 0, "buy", 250);
    await cancel();
    const again = await cancel();
    expect(again).toMatchObject({ already_cancelled: true, refunded_users: 0 });
    expect(await cash(db, alice)).toBe(10000);
    expect((await db.query("select 1 from public.trades where kind = 'refund'")).rows).toHaveLength(1);
    expect((await db.query("select 1 from public.admin_actions where action = 'cancel_custom_market'")).rows).toHaveLength(1);
  });

  it("a cancelled market can't then be resolved, traded or edited", async () => {
    await t(alice, 0, "buy", 250);
    await cancel();
    await expect(db.query("select public.resolve_custom_market($1,$2,0)", [admin, id])).rejects.toThrow(/market_cancelled/);
    await expect(db.query("select public.resolve_market($1, $2)", [`custom:${id}`, JSON.stringify({ [`custom:${id}:0`]: 1, [`custom:${id}:1`]: 0, [`custom:${id}:2`]: 0, [`custom:${id}:3`]: 0 })])).resolves.toBeTruthy();
    expect(await cash(db, alice)).toBe(10000); // generic resolve_market saw it as already settled: paid nothing
    await expect(t(alice, 0, "buy", 10)).rejects.toThrow(/market_resolved/);
    await expect(
      db.query("select public.admin_save_custom_market($1,$2,'beahy-other-leg','x title','d','r rules here',array['A','B'],'2099-01-01',1000,false)", [admin, id]),
    ).rejects.toThrow(/market_closed|locked_after_trades/);
    // Even a description-only edit (allowed on traded markets) is frozen once cancelled.
    await expect(
      db.query(
        "select public.admin_save_custom_market($1,$2,'beahy-other-leg','When will Beahy fall over and break her other leg?','new description','Range containing the date.',array['Before Jan 1, 2027','Jan to Jun 2027','Jul to Dec 2027','Not by end of 2027'],'2099-01-01',1000,false)",
        [admin, id],
      ),
    ).rejects.toThrow(/market_closed/);
  });

  it("a resolved market can't be cancelled; drafts can't be cancelled", async () => {
    await t(alice, 0, "buy", 100);
    await db.query("select public.resolve_custom_market($1,$2,0)", [admin, id]);
    await expect(cancel()).rejects.toThrow(/already_resolved/);
    const draft = (await db.query<{ id: string }>("select id from public.custom_markets where slug = 'liam-garage-flake'")).rows[0].id;
    await expect(db.query("select public.cancel_custom_market($1,$2)", [admin, draft])).rejects.toThrow(/not_published/);
  });

  it("members can't call it", async () => {
    await db.exec("set role authenticated");
    try {
      await expect(db.exec(`select public.cancel_custom_market('${alice}', '${id}')`)).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });
});

describe("0004 seeds and re-runs", () => {
  it("drafts end at 11:59 PM Hawaii time", async () => {
    const rows = (await db.query<{ slug: string; end_utc: string }>("select slug, to_char(end_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as end_utc from public.custom_markets where status = 'draft' and slug not like 'ironman-2026-%' order by slug")).rows;
    expect(rows).toEqual([
      { slug: "beahy-harry-mclary", end_utc: "2028-01-01 09:59:59" },
      { slug: "hannahs-next-job", end_utc: "2027-04-01 09:59:59" },
      { slug: "liam-garage-flake", end_utc: "2027-07-01 09:59:59" },
    ]);
  });

  it("0004 is safe to re-run and never moves a published market's date", async () => {
    const before = (await db.query<{ end_at: string }>("select end_at from public.custom_markets where id = $1", [id])).rows[0].end_at;
    const sql = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "0004_cancel_and_hawaii.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql);
    expect((await db.query<{ end_at: string }>("select end_at from public.custom_markets where id = $1", [id])).rows[0].end_at).toEqual(before);
    await t(alice, 0, "buy", 100);
    expect(Number((await cancel()).total_refunded)).toBeGreaterThan(0);
  });
});
