import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { cash, createAuthUser, freshDb } from "./db";

// Runs the real migrations (0001-0005) in PGlite, on the seeded Hannah market.

let db: PGlite;
let admin: string;
let alice: string;
let id: string;

type M = { outcomes: string[]; q: number[]; liquidity: string; rules: string };
const market = async () => (await db.query<M>("select outcomes, q, liquidity, rules from public.custom_markets where id = $1", [id])).rows[0];
const prices = async () => {
  const m = await market();
  return (await db.query<{ p: number[] }>("select public.lmsr_prices($1, $2) as p", [m.q, Number(m.liquidity)])).rows[0].p;
};
const add = (name: string, p: number, rules: string | null = null) =>
  db.query<{ r: { outcomes: string[]; prices: number[] } }>("select public.admin_add_custom_outcome($1,$2,$3,$4,$5) as r", [admin, id, name, p, rules]).then((r) => r.rows[0].r);
const buy = (user: string, idx: number, amount: number) =>
  db.query("select public.execute_custom_trade($1,$2,$3,'buy',$4,null,0.02,2000)", [user, id, idx, amount]);

beforeEach(async () => {
  db = await freshDb();
  admin = await createAuthUser(db, "admin@example.com", "Admin");
  alice = await createAuthUser(db, "a@example.com", "Alice");
  id = (await db.query<{ id: string }>("select id from public.custom_markets where slug = 'hannahs-next-job'")).rows[0].id;
  const m = await market();
  await db.query("select public.admin_save_custom_market($1,$2,'hannahs-next-job','What will Hannah''s next job be?','',$3,$4,'2099-01-01',1000,true)", [admin, id, m.rules, m.outcomes]);
});

describe("admin_add_custom_outcome", () => {
  it("adds the option at the chosen chance and scales the others, keeping their relative odds", async () => {
    await buy(alice, 0, 500); // Bakery is now the favourite
    const before = await prices();
    const r = await add("Making waffles or something", 0.05);
    expect(r.outcomes).toHaveLength(10);
    expect(r.outcomes[9]).toBe("Making waffles or something");
    expect(r.prices[9]).toBeCloseTo(0.05, 6);
    for (let i = 0; i < 9; i++) expect(r.prices[i]).toBeCloseTo(before[i] * 0.95, 6);
    expect(r.prices.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("keeps everyone's shares and cash, and the new option is tradable and can win", async () => {
    await buy(alice, 0, 300);
    const sharesBefore = (await db.query<{ shares: string }>("select shares from public.positions where user_id = $1", [alice])).rows[0].shares;
    const cashBefore = await cash(db, alice);
    await add("Making waffles or something", 0.1);
    expect((await db.query<{ shares: string }>("select shares from public.positions where user_id = $1", [alice])).rows[0].shares).toBe(sharesBefore);
    expect(await cash(db, alice)).toBe(cashBefore);
    const tokens = (await db.query<{ outcomes: { token_id: string }[] }>("select outcomes from public.markets where condition_id = $1", [`custom:${id}`])).rows[0].outcomes;
    expect(tokens.at(-1)!.token_id).toBe(`custom:${id}:9`);
    await buy(alice, 9, 100);
    const before = await cash(db, alice);
    const wShares = Number((await db.query<{ shares: string }>("select shares from public.positions where user_id = $1 and token_id = $2", [alice, `custom:${id}:9`])).rows[0].shares);
    await db.query("select public.resolve_custom_market($1,$2,9)", [admin, id]);
    expect(await cash(db, alice)).toBeCloseTo(before + Math.floor(wShares * 100) / 100, 2);
  });

  it("can update the rules in the same step, and logs it", async () => {
    await add("Making waffles or something", 0.05, "New rules text that mentions waffles.");
    expect((await market()).rules).toBe("New rules text that mentions waffles.");
    const log = (await db.query<{ details: { outcome: string; rules_changed: boolean } }>("select details from public.admin_actions where action = 'add_custom_outcome'")).rows;
    expect(log[0].details).toMatchObject({ outcome: "Making waffles or something", rules_changed: true });
  });

  it("refuses duplicates, bad chances, more than 12 outcomes, and closed markets", async () => {
    await expect(add("bakery", 0.05)).rejects.toThrow(/duplicate_outcome/);
    await expect(add("Waffles", 0.6)).rejects.toThrow(/invalid_start_price/);
    await expect(add("Waffles", 0)).rejects.toThrow(/invalid_start_price/);
    await add("A", 0.02);
    await add("B", 0.02);
    await add("C", 0.02);
    await expect(add("D", 0.02)).rejects.toThrow(/too_many_outcomes/);
    await db.query("select public.cancel_custom_market($1,$2)", [admin, id]);
    await expect(add("E", 0.02)).rejects.toThrow(/market_closed/);
  });

  it("members can't call it", async () => {
    await db.exec("set role authenticated");
    try {
      await expect(db.exec(`select public.admin_add_custom_outcome('${alice}', '${id}', 'Hack', 0.5, null)`)).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });

  it("0005 is safe to re-run", async () => {
    const sql = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "0005_add_outcome.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql);
    expect((await add("Making waffles or something", 0.05)).outcomes).toHaveLength(10);
  });
});
