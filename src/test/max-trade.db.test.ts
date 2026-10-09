import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cash, createAuthUser, freshDb, trade } from "./db";

// Runs the real migrations (0001-0006) in PGlite.
describe("per-trade maximum ($2,000) enforced by the database", () => {
  it("refuses a Polymarket-style buy or sell over $2,000 and changes nothing", async () => {
    const db = await freshDb();
    const alice = await createAuthUser(db, "a@example.com", "Alice");
    await expect(trade(db, alice, "buy", 5000, 2000.01, 0.4)).rejects.toThrow(/trade_too_large/);
    expect(await cash(db, alice)).toBe(10000);
    await trade(db, alice, "buy", 5000, 2000, 0.4); // exactly the max is fine
    await trade(db, alice, "buy", 5000, 2000, 0.4);
    await expect(trade(db, alice, "sell", 9000, 4500, 0.5)).rejects.toThrow(/trade_too_large/);
    expect(await cash(db, alice)).toBe(6000);
  });

  it("custom (LMSR) trades stay under the cap even when asked for more", async () => {
    const db = await freshDb();
    const admin = await createAuthUser(db, "admin@example.com", "Admin");
    const alice = await createAuthUser(db, "a@example.com", "Alice");
    const id = (await db.query<{ id: string }>("select id from public.custom_markets where slug = 'liam-garage-flake'")).rows[0].id;
    await db.query("select public.admin_save_custom_market($1,$2,'liam-garage-flake','Will Liam add more flake?','','Yes if more flake.',array['Yes','No'],'2099-01-01',1000,true)", [admin, id]);
    const r = await db.query<{ r: { total: string } }>("select public.execute_custom_trade($1,$2,0,'buy',9000,null,0.02,2000) as r", [alice, id]);
    expect(Number(r.rows[0].r.total)).toBeLessThanOrEqual(2000);
  });

  it("payouts above $2,000 are still allowed", async () => {
    const db = await freshDb();
    const alice = await createAuthUser(db, "a@example.com", "Alice");
    await trade(db, alice, "buy", 5000, 2000, 0.4);
    await db.query(`select public.resolve_market('0xabc', '{"111": 1, "222": 0}')`);
    expect(await cash(db, alice)).toBe(13000);
  });

  it("0006 is safe to re-run", async () => {
    const db = await freshDb();
    const sql = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "0006_max_trade_guard.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql);
    const alice = await createAuthUser(db, "a@example.com", "Alice");
    await expect(trade(db, alice, "buy", 6000, 2500, 0.4)).rejects.toThrow(/trade_too_large/);
  });
});
