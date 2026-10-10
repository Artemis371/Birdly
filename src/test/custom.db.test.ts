import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { prices as tsPrices, quoteLmsrBuy } from "@/lib/lmsr/lmsr";
import { cash, createAuthUser, freshDb } from "./db";

// Runs the real migrations (0001-0003) in PGlite.

let db: PGlite;
let admin: string;
let alice: string;
let bob: string;

beforeEach(async () => {
  db = await freshDb();
  admin = await createAuthUser(db, "admin@example.com", "Admin");
  alice = await createAuthUser(db, "a@example.com", "Alice");
  bob = await createAuthUser(db, "b@example.com", "Bob");
});

type Row = { id: string; status: string; q: number[]; outcomes: string[]; liquidity: string; end_at: string };
const get = async (slug: string) => (await db.query<Row>("select * from public.custom_markets where slug = $1", [slug])).rows[0];

async function save(id: string | null, o: Partial<{ slug: string; title: string; description: string; rules: string; outcomes: string[]; end: string; liquidity: number; publish: boolean }>) {
  const cur = id ? (await db.query<Row & { slug: string; title: string; description: string; rules: string }>("select * from public.custom_markets where id = $1", [id])).rows[0] : null;
  const r = await db.query<{ id: string }>("select public.admin_save_custom_market($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as id", [
    admin,
    id,
    o.slug ?? cur?.slug ?? "test-market",
    o.title ?? cur?.title ?? "Test market?",
    o.description ?? cur?.description ?? "",
    o.rules ?? cur?.rules ?? "rules",
    o.outcomes ?? cur?.outcomes ?? ["Yes", "No"],
    o.end ?? cur?.end_at ?? "2099-01-01T00:00:00Z",
    o.liquidity ?? (cur ? Number(cur.liquidity) : 1000),
    o.publish ?? false,
  ]);
  return r.rows[0].id;
}

async function tradeCustom(user: string, id: string, idx: number, side: "buy" | "sell", amount: number, refAvg: number | null = null) {
  const r = await db.query<{ r: Record<string, unknown> }>("select public.execute_custom_trade($1,$2,$3,$4,$5,$6,0.02,2000) as r", [user, id, idx, side, amount, refAvg]);
  return r.rows[0].r as { cash: string; filled_shares: number; total: string; avg: string; prices: number[] };
}

describe("seeded drafts", () => {
  it("creates the four drafts with equal starting odds", async () => {
    // (0007 adds the IRONMAN drafts in Rooneys; those are covered in categories.db.test.ts.)
    const rows = (await db.query<Row & { slug: string }>("select * from public.custom_markets where slug not like 'ironman-2026-%' order by slug")).rows;
    expect(rows.map((r) => r.slug)).toEqual(["beahy-harry-mclary", "beahy-other-leg", "hannahs-next-job", "liam-garage-flake"]);
    for (const r of rows) {
      expect(r.status).toBe("draft");
      expect(r.q.every((x) => x === 0)).toBe(true);
    }
    expect((await get("hannahs-next-job")).outcomes).toHaveLength(9);
  });

  it("0003 is safe to re-run and doesn't duplicate or reset seeds", async () => {
    const m = await get("liam-garage-flake");
    await save(m.id, { publish: true });
    const sql = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "0003_custom_markets.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql);
    expect((await db.query("select * from public.custom_markets where slug not like 'ironman-2026-%'")).rows).toHaveLength(4);
    expect((await get("liam-garage-flake")).status).toBe("open");
  });
});

describe("publishing and trading", () => {
  let id: string;
  beforeEach(async () => {
    id = (await get("liam-garage-flake")).id;
  });

  it("drafts can't be traded", async () => {
    await expect(tradeCustom(alice, id, 0, "buy", 10)).rejects.toThrow(/not_found/);
  });

  it("publishing opens trading at 50/50 and creates the markets row + first chart point", async () => {
    await save(id, { publish: true });
    const m = (await db.query<{ source: string; outcomes: { token_id: string }[] }>("select * from public.markets where condition_id = $1", [`custom:${id}`])).rows[0];
    expect(m.source).toBe("custom");
    expect(m.outcomes.map((o) => o.token_id)).toEqual([`custom:${id}:0`, `custom:${id}:1`]);
    const pts = (await db.query<{ prices: number[] }>("select prices from public.custom_price_points where market_id = $1", [id])).rows;
    expect(pts).toHaveLength(1);
    expect(pts[0].prices[0]).toBeCloseTo(0.5);
  });

  it("a buy moves the price, matches the TypeScript LMSR exactly, and records a chart point", async () => {
    await save(id, { publish: true });
    const expected = quoteLmsrBuy([0, 0], 1000, 0, 100, { maxTradeUsd: 2000 });
    const r = await tradeCustom(alice, id, 0, "buy", 100);
    if (!expected.ok) throw new Error();
    expect(Number(r.total)).toBe(expected.total);
    expect(Number(r.filled_shares)).toBeCloseTo(expected.shares, 3);
    expect(Number(r.cash)).toBe(10000 - expected.total);
    expect(r.prices[0]).toBeCloseTo(tsPrices([expected.shares, 0], 1000)[0], 4);
    expect((await get("liam-garage-flake")).q[0]).toBeCloseTo(expected.shares, 3);
    expect((await db.query("select 1 from public.custom_price_points where market_id = $1", [id])).rows).toHaveLength(2);
    const pos = (await db.query<{ shares: string; token_id: string }>("select * from public.positions where user_id = $1", [alice])).rows[0];
    expect(pos.token_id).toBe(`custom:${id}:0`);
  });

  it("selling returns money and lowers the price; can't oversell", async () => {
    await save(id, { publish: true });
    const b = await tradeCustom(alice, id, 0, "buy", 200);
    const s = await tradeCustom(alice, id, 0, "sell", Number(b.filled_shares) / 2);
    expect(Number(s.total)).toBeGreaterThan(0);
    expect(s.prices[0]).toBeLessThan(b.prices[0]);
    await expect(tradeCustom(alice, id, 0, "sell", 1_000_000)).rejects.toThrow(/insufficient_shares/);
    await expect(tradeCustom(bob, id, 0, "sell", 1)).rejects.toThrow(/insufficient_shares/);
  });

  it("can't overspend", async () => {
    await save(id, { publish: true });
    for (let k = 0; k < 5; k++) await tradeCustom(alice, id, 1, "buy", 2000);
    await expect(tradeCustom(alice, id, 1, "buy", 2000)).rejects.toThrow(/insufficient_funds/);
    expect(await cash(db, alice)).toBeGreaterThanOrEqual(0);
  });

  it("rejects the fill if the price moved more than the tolerance since the quote", async () => {
    await save(id, { publish: true });
    const quoted = quoteLmsrBuy([0, 0], 1000, 0, 100, { maxTradeUsd: 2000 });
    if (!quoted.ok) throw new Error();
    await tradeCustom(bob, id, 0, "buy", 1500); // someone moves the price first
    await expect(tradeCustom(alice, id, 0, "buy", 100, quoted.avgPrice)).rejects.toThrow(/price_moved/);
    expect(await cash(db, alice)).toBe(10000);
  });

  it("trading closes automatically at the end date", async () => {
    await save(id, { publish: true, end: "2000-01-01T00:00:00Z" });
    await expect(tradeCustom(alice, id, 0, "buy", 10)).rejects.toThrow(/market_ended/);
  });
});

describe("editing rules", () => {
  it("drafts are fully editable; once traded only description and end date can change", async () => {
    const id = (await get("liam-garage-flake")).id;
    await save(id, { title: "Will Liam re-flake?", outcomes: ["Yes", "No", "Maybe"] });
    expect((await get("liam-garage-flake")).outcomes).toEqual(["Yes", "No", "Maybe"]);
    await save(id, { outcomes: ["Yes", "No"], publish: true });
    await tradeCustom(alice, id, 0, "buy", 50);
    await save(id, { description: "updated", end: "2099-06-01T00:00:00Z" });
    await expect(save(id, { title: "Something else" })).rejects.toThrow(/locked_after_trades/);
    await expect(save(id, { outcomes: ["A", "B"] })).rejects.toThrow(/locked_after_trades/);
    await expect(save(id, { liquidity: 50 })).rejects.toThrow(/locked_after_trades/);
    await expect(save(id, { rules: "new rules" })).rejects.toThrow(/locked_after_trades/);
  });

  it("only drafts can be deleted", async () => {
    const id = (await get("liam-garage-flake")).id;
    await save(id, { publish: true });
    await expect(db.query("select public.admin_delete_custom_draft($1,$2)", [admin, id])).rejects.toThrow(/not_a_draft/);
    const draft = (await get("beahy-other-leg")).id;
    await db.query("select public.admin_delete_custom_draft($1,$2)", [admin, draft]);
    expect(await get("beahy-other-leg")).toBeUndefined();
  });
});

describe("resolution", () => {
  it("early resolution pays $1 per winning share, $0 otherwise, exactly once", async () => {
    const id = (await get("beahy-other-leg")).id;
    await save(id, { publish: true });
    const a = await tradeCustom(alice, id, 1, "buy", 300); // "Jan to Jun 2027"
    await tradeCustom(bob, id, 3, "buy", 300); // "Not by end of 2027"
    const before = await cash(db, alice);
    const r = await db.query<{ r: { paid_positions: number } }>("select public.resolve_custom_market($1,$2,1) as r", [admin, id]);
    expect(r.rows[0].r.paid_positions).toBe(2);
    expect(await cash(db, alice)).toBeCloseTo(before + Math.floor(Number(a.filled_shares) * 100) / 100, 2);
    expect(await cash(db, bob)).toBe(9700);
    const again = await db.query<{ r: { already_resolved: boolean } }>("select public.resolve_custom_market($1,$2,0) as r", [admin, id]);
    expect(again.rows[0].r.already_resolved).toBe(true);
    expect((await get("beahy-other-leg")).status).toBe("resolved");
    await expect(tradeCustom(alice, id, 1, "buy", 10)).rejects.toThrow(/market_resolved/);
    await expect(save(id, { description: "x" })).rejects.toThrow(/already_resolved/);
  });

  it("drafts can't be resolved and the winner must exist", async () => {
    const id = (await get("hannahs-next-job")).id;
    await expect(db.query("select public.resolve_custom_market($1,$2,0)", [admin, id])).rejects.toThrow(/not_published/);
    await save(id, { publish: true });
    await expect(db.query("select public.resolve_custom_market($1,$2,9)", [admin, id])).rejects.toThrow(/invalid_winner/);
  });
});

describe("visibility and privileges", () => {
  async function as<T>(role: string, fn: () => Promise<T>) {
    await db.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  }

  it("members can see published markets but not drafts; visitors see nothing", async () => {
    const id = (await get("liam-garage-flake")).id;
    await save(id, { publish: true });
    const rows = await as("authenticated", () => db.query<{ slug: string }>("select slug from public.custom_markets"));
    expect(rows.rows.map((r) => r.slug)).toEqual(["liam-garage-flake"]);
    await expect(as("anon", () => db.query("select * from public.custom_markets"))).rejects.toThrow(/permission denied/);
  });

  it("members can't call any custom-market function or write directly", async () => {
    const id = (await get("liam-garage-flake")).id;
    for (const sql of [
      `select public.execute_custom_trade('${alice}', '${id}', 0, 'buy', 10, null, 0.02, 2000)`,
      `select public.resolve_custom_market('${alice}', '${id}', 0)`,
      `select public.admin_save_custom_market('${alice}', null, 'x-y', 'Title here', '', '', array['A','B'], now(), 1000, true)`,
      `update public.custom_markets set q = array[1e9, 0] where id = '${id}'`,
    ]) {
      await expect(as("authenticated", () => db.exec(sql))).rejects.toThrow(/permission denied/);
    }
  });
});
