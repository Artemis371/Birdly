import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { cash, createAuthUser, freshDb, market, trade } from "./db";

// These run the real supabase/migrations/*.sql in an in-memory Postgres.

let db: PGlite;
beforeEach(async () => {
  db = await freshDb();
});

async function count(sql: string, params: unknown[] = []) {
  const r = await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`, params);
  return r.rows[0].n;
}

describe("signup: account + profile + starting balance are atomic", () => {
  it("creating an auth user creates the profile and grants exactly $10,000", async () => {
    const id = await createAuthUser(db, "a@example.com", "Alice");
    expect(await cash(db, id)).toBe(10000);
    expect(await count("select 1 from public.profiles where id = $1", [id])).toBe(1);
    expect(await count("select 1 from public.balances where user_id = $1", [id])).toBe(1);
  });

  it("the starting balance can never be granted twice", async () => {
    const id = await createAuthUser(db, "a@example.com", "Alice");
    await expect(
      db.query("insert into public.balances (user_id, season_id, cash) values ($1, 1, 10000)", [id]),
    ).rejects.toThrow(/duplicate key/);
    expect(await cash(db, id)).toBe(10000);
  });

  it("duplicate display name (any case) rolls back the whole account, auth user included", async () => {
    await createAuthUser(db, "a@example.com", "Alice");
    await expect(createAuthUser(db, "b@example.com", "aLiCe")).rejects.toThrow(/profiles_display_name_ci/);
    expect(await count("select 1 from auth.users where email = 'b@example.com'")).toBe(0);
    expect(await count("select 1 from public.balances")).toBe(1);
  });

  it("duplicate email is rejected by auth and creates nothing", async () => {
    await createAuthUser(db, "a@example.com", "Alice");
    await expect(createAuthUser(db, "a@example.com", "Bob")).rejects.toThrow(/duplicate key/);
    expect(await count("select 1 from public.profiles")).toBe(1);
  });

  it("trims surrounding whitespace from display names", async () => {
    const id = await createAuthUser(db, "a@example.com", "  Alice ");
    const r = await db.query<{ display_name: string }>("select display_name from public.profiles where id = $1", [id]);
    expect(r.rows[0].display_name).toBe("Alice");
  });

  it.each([["ab"], ["x".repeat(21)], ["Al!ce"], ["bad<name>"], [""]])("rejects invalid display name %j", async (name) => {
    await expect(createAuthUser(db, "a@example.com", name)).rejects.toThrow();
    expect(await count("select 1 from auth.users")).toBe(0);
  });

  it("refuses to create accounts if there is no current season", async () => {
    await db.exec("update public.seasons set is_current = false");
    await expect(createAuthUser(db, "a@example.com", "Alice")).rejects.toThrow(/no_current_season/);
    expect(await count("select 1 from auth.users")).toBe(0);
  });
});

describe("execute_trade", () => {
  let alice: string;
  beforeEach(async () => {
    alice = await createAuthUser(db, "a@example.com", "Alice");
  });

  it("buy debits cash, creates the position, logs the trade", async () => {
    const r = await trade(db, alice, "buy", 100, 42, 0.42);
    expect(Number(r.cash)).toBe(9958);
    expect(Number(r.shares)).toBe(100);
    const pos = (await db.query<{ shares: string; cost_basis: string }>("select shares, cost_basis from public.positions")).rows[0];
    expect(Number(pos.shares)).toBe(100);
    expect(Number(pos.cost_basis)).toBe(42);
    expect(await count("select 1 from public.trades where kind = 'buy'")).toBe(1);
    expect(await count("select 1 from public.markets where condition_id = '0xabc'")).toBe(1);
  });

  it("buys accumulate shares and cost basis", async () => {
    await trade(db, alice, "buy", 100, 40, 0.4);
    await trade(db, alice, "buy", 50, 25, 0.5);
    const pos = (await db.query<{ shares: string; cost_basis: string }>("select shares, cost_basis from public.positions")).rows[0];
    expect(Number(pos.shares)).toBe(150);
    expect(Number(pos.cost_basis)).toBe(65);
  });

  it("partial sell credits cash and removes cost basis proportionally", async () => {
    await trade(db, alice, "buy", 100, 40, 0.4);
    const r = await trade(db, alice, "sell", 25, 15, 0.6);
    expect(Number(r.cash)).toBe(9975);
    const pos = (await db.query<{ shares: string; cost_basis: string; realized_pnl: string }>("select * from public.positions")).rows[0];
    expect(Number(pos.shares)).toBe(75);
    expect(Number(pos.cost_basis)).toBe(30);
    expect(Number(pos.realized_pnl)).toBe(5);
  });

  it("full sell removes all cost basis", async () => {
    await trade(db, alice, "buy", 3, 1, 0.333333);
    await trade(db, alice, "sell", 3, 0.99, 0.33);
    const pos = (await db.query<{ shares: string; cost_basis: string; realized_pnl: string }>("select * from public.positions")).rows[0];
    expect(Number(pos.shares)).toBe(0);
    expect(Number(pos.cost_basis)).toBe(0);
    expect(Number(pos.realized_pnl)).toBeCloseTo(-0.01);
  });

  it("rejects buys beyond available cash and changes nothing", async () => {
    await expect(trade(db, alice, "buy", 30000, 10000.01, 0.4)).rejects.toThrow(/insufficient_funds/);
    expect(await cash(db, alice)).toBe(10000);
    expect(await count("select 1 from public.positions")).toBe(0);
    expect(await count("select 1 from public.trades")).toBe(0);
  });

  it("can spend exactly the whole balance, never below zero", async () => {
    await trade(db, alice, "buy", 25000, 10000, 0.4);
    expect(await cash(db, alice)).toBe(0);
    await expect(trade(db, alice, "buy", 1, 0.01, 0.01)).rejects.toThrow(/insufficient_funds/);
  });

  it("rejects selling shares you don't own, or more than you own", async () => {
    await expect(trade(db, alice, "sell", 1, 0.5, 0.5)).rejects.toThrow(/insufficient_shares/);
    await trade(db, alice, "buy", 10, 5, 0.5);
    await expect(trade(db, alice, "sell", 10.0001, 5, 0.5)).rejects.toThrow(/insufficient_shares/);
    expect(await cash(db, alice)).toBe(9995);
  });

  it("rejects a token that doesn't belong to the market", async () => {
    const m = market();
    await expect(
      db.query("select public.execute_trade($1,'buy','999',1,0.5,0.5,$2)", [alice, JSON.stringify(m)]),
    ).rejects.toThrow(/invalid_market/);
  });

  it("rejects nonsense amounts and prices", async () => {
    await expect(trade(db, alice, "buy", 0, 1, 0.5)).rejects.toThrow(/invalid_amount/);
    await expect(trade(db, alice, "buy", 1, -1, 0.5)).rejects.toThrow(/invalid_amount/);
    await expect(trade(db, alice, "buy", 1, 1, 1)).rejects.toThrow(/invalid_amount/);
  });

  it("deactivated users can't trade", async () => {
    await db.query("select public.admin_set_active(null, $1, false)", [alice]);
    await expect(trade(db, alice, "buy", 10, 5, 0.5)).rejects.toThrow(/account_inactive/);
  });

  it("can't trade a market that has resolved", async () => {
    await trade(db, alice, "buy", 10, 5, 0.5);
    await db.exec("update public.markets set resolved_at = now()");
    await expect(trade(db, alice, "buy", 10, 5, 0.5)).rejects.toThrow(/market_resolved/);
  });
});

describe("admin functions", () => {
  it("reset restores the starting balance, clears positions, keeps history, and is audited", async () => {
    const alice = await createAuthUser(db, "a@example.com", "Alice");
    await trade(db, alice, "buy", 1000, 400, 0.4);
    await db.query("select public.admin_reset_balance(null, $1)", [alice]);
    expect(await cash(db, alice)).toBe(10000);
    expect(await count("select 1 from public.positions")).toBe(0);
    expect(await count("select 1 from public.trades")).toBe(1);
    expect(await count("select 1 from public.admin_actions where action = 'reset_balance'")).toBe(1);
  });

  it("reactivation clears the deactivated flag", async () => {
    const alice = await createAuthUser(db, "a@example.com", "Alice");
    await db.query("select public.admin_set_active(null, $1, false)", [alice]);
    await db.query("select public.admin_set_active(null, $1, true)", [alice]);
    expect(await count("select 1 from public.profiles where deactivated_at is null")).toBe(1);
  });
});

describe("display names", () => {
  it("change enforces case-insensitive uniqueness", async () => {
    await createAuthUser(db, "a@example.com", "Alice");
    const bob = await createAuthUser(db, "b@example.com", "Bob");
    await expect(db.query("select public.set_display_name($1, 'ALICE')", [bob])).rejects.toThrow(/profiles_display_name_ci/);
    await db.query("select public.set_display_name($1, 'Robert')", [bob]);
    expect(await count("select 1 from public.profiles where display_name = 'Robert'")).toBe(1);
  });
});

describe("snapshots", () => {
  it("upserts one row per day", async () => {
    const alice = await createAuthUser(db, "a@example.com", "Alice");
    await db.query("select public.record_snapshot($1, 12.345)", [alice]);
    await db.query("select public.record_snapshot($1, 20)", [alice]);
    const rows = (await db.query<{ total: string }>("select total from public.account_snapshots")).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].total)).toBe(10020);
  });
});

describe("rate_limit_hit", () => {
  it("allows up to max hits per window", async () => {
    const hit = async () => (await db.query<{ ok: boolean }>("select public.rate_limit_hit('k', 3, 60) as ok")).rows[0].ok;
    expect([await hit(), await hit(), await hit(), await hit()]).toEqual([true, true, true, false]);
    await db.exec("update public.rate_limits set window_start = now() - interval '61 seconds'");
    expect(await hit()).toBe(true);
  });
});

describe("row level security and privileges", () => {
  let alice: string;
  beforeEach(async () => {
    alice = await createAuthUser(db, "a@example.com", "Alice");
    await trade(db, alice, "buy", 10, 5, 0.5);
  });

  async function as(role: "anon" | "authenticated", fn: () => Promise<unknown>) {
    await db.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  }

  it("signed-in members can read group data", async () => {
    const r = (await as("authenticated", () => db.query("select display_name from public.profiles"))) as { rows: unknown[] };
    expect(r.rows).toHaveLength(1);
  });

  it("signed-in members cannot write anything directly", async () => {
    for (const sql of [
      `update public.balances set cash = 1000000`,
      `insert into public.balances (user_id, season_id, cash) values ('${alice}', 1, 5)`,
      `update public.positions set shares = 99999`,
      `delete from public.trades`,
      `update public.profiles set deactivated_at = null`,
      `insert into public.markets (condition_id, event_slug, event_title, question, label, outcomes) values ('x','x','x','x','x','[]')`,
    ]) {
      await expect(as("authenticated", () => db.exec(sql))).rejects.toThrow(/permission denied/);
    }
    expect(await cash(db, alice)).toBe(9995);
  });

  it("signed-in members cannot call the trade or admin functions", async () => {
    const m = JSON.stringify(market());
    for (const sql of [
      `select public.execute_trade('${alice}', 'buy', '111', 1, 0, 0.5, '${m}')`,
      `select public.admin_reset_balance(null, '${alice}')`,
      `select public.admin_set_active(null, '${alice}', true)`,
      `select public.set_display_name('${alice}', 'Hacker')`,
      `select public.record_snapshot('${alice}', 1000000)`,
      `select public.rate_limit_hit('x', 1, 1)`,
    ]) {
      await expect(as("authenticated", () => db.exec(sql))).rejects.toThrow(/permission denied/);
    }
  });

  it("anonymous visitors can read nothing", async () => {
    for (const t of ["profiles", "balances", "positions", "trades", "markets", "rate_limits", "admin_actions"]) {
      await expect(as("anon", () => db.query(`select * from public.${t}`))).rejects.toThrow(/permission denied/);
    }
  });

  it("server-only tables are hidden even from signed-in members", async () => {
    for (const t of ["rate_limits", "admin_actions"]) {
      await expect(as("authenticated", () => db.query(`select * from public.${t}`))).rejects.toThrow(/permission denied/);
    }
  });
});
