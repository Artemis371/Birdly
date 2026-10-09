import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = join(__dirname, "..", "..");

let template: Promise<PGlite> | null = null;

async function buildTemplate(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));
  const dir = join(root, "supabase", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  return db;
}

// Fresh in-memory Postgres with the Supabase stub + every migration applied.
// Migrations run once; each test gets a cheap clone of that template.
export async function freshDb(): Promise<PGlite> {
  template ??= buildTemplate();
  return (await (await template).clone()) as PGlite;
}

// Simulates Supabase Auth creating a user (auth.admin.createUser).
export async function createAuthUser(db: PGlite, email: string, displayName: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify({ display_name: displayName })],
  );
  return r.rows[0].id;
}

export async function cash(db: PGlite, userId: string): Promise<number> {
  const r = await db.query<{ cash: string }>("select cash from public.balances where user_id = $1", [userId]);
  return Number(r.rows[0]?.cash);
}

export function market(conditionId = "0xabc", tokens = ["111", "222"]) {
  return {
    condition_id: conditionId,
    event_slug: "test-event",
    event_title: "Test event",
    question: "Will it happen?",
    label: "Will it happen?",
    image: null,
    outcomes: [
      { name: "Yes", token_id: tokens[0] },
      { name: "No", token_id: tokens[1] },
    ],
    end_date: "2030-01-01T00:00:00Z",
    outcome_index: 0,
    outcome_name: "Yes",
  };
}

export async function trade(
  db: PGlite,
  userId: string,
  side: "buy" | "sell",
  shares: number,
  amount: number,
  price: number,
  m = market(),
) {
  const r = await db.query<{ r: { trade_id: number; cash: string; shares: string } }>(
    "select public.execute_trade($1, $2, $3, $4, $5, $6, $7) as r",
    [userId, side, m.outcomes[m.outcome_index].token_id, shares, amount, price, JSON.stringify(m)],
  );
  return r.rows[0].r;
}
