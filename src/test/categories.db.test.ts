import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthUser, freshDb } from "./db";

// Custom categories (migration 0007) against the real migrations in PGlite.

const SQL_0007 = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "0007_custom_categories.sql"), "utf8");
let db: PGlite;
let admin: string;
let alice: string;
let leahys: number;
let rooneys: number;

const cat = async (slug: string) => (await db.query<{ id: number }>("select id from public.custom_categories where slug = $1", [slug])).rows[0].id;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const rerun0007 = async () => {
  const r = await db.exec(SQL_0007);
  return (r.at(-1)?.rows ?? []) as { step: string; result: string }[];
};

async function newMarket(slug: string, title: string, publish = true) {
  const r = await one<{ id: string }>("select public.admin_save_custom_market($1,null,$2,$3,'','rules',$4,'2099-01-01T00:00:00Z',1000,$5) as id", [admin, slug, title, ["Yes", "No"], publish]);
  return r.id;
}

beforeEach(async () => {
  db = await freshDb();
  admin = await createAuthUser(db, "admin@example.com", "Admin");
  alice = await createAuthUser(db, "a@example.com", "Alice");
  leahys = await cat("leahys");
  rooneys = await cat("rooneys");
});

describe("categories", () => {
  it("seeds Leahys then Rooneys, with every pre-existing market in Leahys", async () => {
    const cats = (await db.query<{ slug: string; label: string }>("select slug, label from public.custom_categories order by sort_order, id")).rows;
    expect(cats).toEqual([
      { slug: "leahys", label: "Leahys" },
      { slug: "rooneys", label: "Rooneys" },
    ]);
    const old = (await db.query<{ category_id: number }>("select category_id from public.custom_markets where slug not like 'ironman-2026-%'")).rows;
    expect(old.length).toBe(4);
    expect(old.every((r) => r.category_id === leahys)).toBe(true);
  });

  it("new markets default to the first tab", async () => {
    const id = await newMarket("fresh", "Fresh market?");
    expect((await one<{ category_id: number }>("select category_id from public.custom_markets where id = $1", [id])).category_id).toBe(leahys);
  });

  it("admins can create, rename and reorder tabs", async () => {
    const id = (await one<{ id: number }>("select public.admin_create_custom_category($1, 'fam', 'Fam') as id", [admin])).id;
    await db.query("select public.admin_rename_custom_category($1, $2, 'Family')", [admin, id]);
    await db.query("select public.admin_reorder_custom_categories($1, $2)", [admin, [id, rooneys, leahys]]);
    const cats = (await db.query<{ slug: string; label: string }>("select slug, label from public.custom_categories order by sort_order")).rows;
    expect(cats.map((c) => c.label)).toEqual(["Family", "Rooneys", "Leahys"]);
    expect(cats[0].slug).toBe("fam"); // renaming keeps the link
    await expect(db.query("select public.admin_reorder_custom_categories($1, $2)", [admin, [id, rooneys]])).rejects.toThrow("invalid_order");
    await expect(db.query("select public.admin_create_custom_category($1, 'fam', 'Again')", [admin])).rejects.toThrow("custom_categories_slug_key");
  });

  it("members can't run the admin functions", async () => {
    const id = await newMarket("m", "Members market?");
    await db.exec("set role authenticated");
    await expect(db.query("select public.admin_move_custom_market($1, $2, $3)", [alice, id, rooneys])).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.admin_create_custom_category($1, 'x', 'X')", [alice])).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });
});

describe("moving a market", () => {
  it("with open positions changes the category and nothing else", async () => {
    const id = await newMarket("moving", "Moving market?");
    await db.query("select public.execute_custom_trade($1,$2,0,'buy',250,null,0.02,2000)", [alice, id]);
    const snapshot = async () => ({
      market: await one<Record<string, unknown>>("select to_jsonb(m) - 'category_id' as j from public.custom_markets m where id = $1", [id]),
      positions: (await db.query("select * from public.positions where condition_id = $1 order by token_id", [`custom:${id}`])).rows,
      trades: (await db.query("select * from public.trades where condition_id = $1 order by id", [`custom:${id}`])).rows,
      history: (await db.query("select * from public.custom_price_points where market_id = $1 order by id", [id])).rows,
      marketsRow: (await db.query("select * from public.markets where condition_id = $1", [`custom:${id}`])).rows,
      balance: (await db.query("select cash from public.balances where user_id = $1", [alice])).rows,
    });
    const before = await snapshot();
    expect(before.positions.length).toBe(1);
    await db.query("select public.admin_move_custom_market($1, $2, $3)", [admin, id, rooneys]);
    expect((await one<{ category_id: number }>("select category_id from public.custom_markets where id = $1", [id])).category_id).toBe(rooneys);
    expect(await snapshot()).toEqual(before);
    const log = await one<{ action: string }>("select action from public.admin_actions order by id desc limit 1");
    expect(log.action).toBe("move_custom_market");
  });

  it("works on resolved markets, which otherwise stay frozen", async () => {
    const id = await newMarket("done", "Done market?");
    await db.query("select public.resolve_custom_market($1, $2, 0)", [admin, id]);
    await db.query("select public.admin_move_custom_market($1, $2, $3)", [admin, id, rooneys]);
    expect((await one<{ category_id: number }>("select category_id from public.custom_markets where id = $1", [id])).category_id).toBe(rooneys);
    await expect(db.query("update public.custom_markets set title = 'Changed?' where id = $1", [id])).rejects.toThrow("market_closed");
  });

  it("rejects an unknown category or market", async () => {
    const id = await newMarket("m2", "Another market?");
    await expect(db.query("select public.admin_move_custom_market($1, $2, 9999)", [admin, id])).rejects.toThrow("category_not_found");
    await expect(db.query("select public.admin_move_custom_market($1, gen_random_uuid(), $2)", [admin, rooneys])).rejects.toThrow("not_found");
  });
});

describe("migration 0007 moves and seeds", () => {
  it("moves the FJ manual market to Rooneys when exactly one title matches", async () => {
    const id = await newMarket("fj-manual", "Will Uncle Dawg ever use the FJ manual in Bird's garage?");
    const report = await rerun0007();
    expect(report.find((r) => r.step === "FJ manual market")?.result).toBe("In Rooneys: Will Uncle Dawg ever use the FJ manual in Bird's garage?");
    expect((await one<{ category_id: number }>("select category_id from public.custom_markets where id = $1", [id])).category_id).toBe(rooneys);
  });

  it("doesn't guess when several titles match, and lists them instead", async () => {
    const a = await newMarket("fj-1", "Will Uncle Dawg use the FJ manual?");
    await newMarket("fj-2", "Will anyone read the FJ manual?");
    const report = await rerun0007();
    const r = report.find((x) => x.step === "FJ manual market")?.result ?? "";
    expect(r).toMatch(/^NOT moved: 2 titles match/);
    expect(r).toContain("Will anyone read the FJ manual?");
    expect((await one<{ category_id: number }>("select category_id from public.custom_markets where id = $1", [a])).category_id).toBe(leahys);
  });

  it("creates the IRONMAN drafts in Rooneys, closing 12:55 PM Hawaii time", async () => {
    const rows = (await db.query<{ title: string; status: string; category_id: number; end_at: Date; outcomes: string[]; description: string; rules: string }>(
      "select * from public.custom_markets where slug like 'ironman-2026-%' order by slug",
    )).rows;
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.status).toBe("draft");
      expect(r.category_id).toBe(rooneys);
      expect(new Date(r.end_at).toISOString()).toBe("2026-10-10T22:55:00.000Z"); // 12:55 PM HST
      expect(r.description).toContain("At creation (checked");
      expect(r.rules).toContain("official IRONMAN results for the professional race");
    }
    const men = rows.find((r) => r.title.startsWith("Who wins the men"))!;
    expect(men.outcomes.at(-1)).toBe("Someone else");
  });

  it("moves an existing market with a matching title instead of duplicating it", async () => {
    await db.exec("delete from public.custom_markets where slug like 'ironman-2026-%'");
    const mine = await newMarket("my-mens-kona", "Who wins the men's 2026 IRONMAN World Championship?", false);
    const report = await rerun0007();
    expect(report.find((r) => r.step === "IRONMAN 1")?.result).toMatch(/^Already existed, now in Rooneys/);
    const men = (await db.query<{ id: string; category_id: number }>("select id, category_id from public.custom_markets where lower(title) = lower($1)", ["Who wins the men's 2026 IRONMAN World Championship?"])).rows;
    expect(men).toEqual([{ id: mine, category_id: rooneys }]);
    expect((await db.query("select 1 from public.custom_markets where slug like 'ironman-2026-%'")).rows).toHaveLength(4); // the other four
  });

  it("is safe to re-run: no duplicates, nothing reset", async () => {
    const id = (await one<{ id: string }>("select id from public.custom_markets where slug = 'liam-garage-flake'")).id;
    await db.query("select public.admin_move_custom_market($1, $2, $3)", [admin, id, rooneys]);
    await rerun0007();
    await rerun0007();
    expect((await db.query("select 1 from public.custom_categories")).rows).toHaveLength(2);
    expect((await db.query("select 1 from public.custom_markets where slug like 'ironman-2026-%'")).rows).toHaveLength(5);
    // A market an admin moved stays where they put it.
    expect((await one<{ category_id: number }>("select category_id from public.custom_markets where id = $1", [id])).category_id).toBe(rooneys);
  });
});
