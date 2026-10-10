import { beforeEach, describe, expect, it, vi } from "vitest";

// Proves the top bar, the leaderboard and the portfolio page show the same
// account value. Runs the real loaders against an in-memory fake of the
// Supabase query builder, with Polymarket's POST /books mocked.

type Row = Record<string, unknown>;
const db: { tables: Record<string, Row[]>; rpcs: { fn: string; args: unknown }[] } = { tables: {}, rpcs: [] };

function query(name: string) {
  let rows = [...(db.tables[name] ?? [])];
  let one = false;
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
    gt: (c: string, v: number) => ((rows = rows.filter((r) => Number(r[c]) > v)), q),
    in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
    order: (c: string, o?: { ascending?: boolean }) => ((rows = rows.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (o?.ascending === false ? -1 : 1))), q),
    limit: (n: number) => ((rows = rows.slice(0, n)), q),
    single: () => ((one = true), q),
    maybeSingle: () => ((one = true), q),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: one ? (rows[0] ?? null) : rows, error: null }).then(res, rej),
  };
  return q;
}
const fakeClient = {
  from: query,
  rpc: async (fn: string, args: unknown) => (db.rpcs.push({ fn, args }), { error: null }),
};

vi.mock("@/lib/supabase/admin", () => ({ adminClient: () => fakeClient }));
const fetchBooks = vi.fn();
vi.mock("@/lib/polymarket/api", async (orig) => ({ ...(await orig<typeof import("@/lib/polymarket/api")>()), fetchBooks: (ids: string[]) => fetchBooks(ids) }));

const { getAccountSummary, valueAccount } = await import("./account-value");
const { loadLeaderboard } = await import("./leaderboard");
const { loadPortfolio } = await import("./portfolio");
const { MARK_TTL_MS, __resetMarkCache } = await import("./valuation");

const ME = "11111111-1111-1111-1111-111111111111";
const YOU = "22222222-2222-2222-2222-222222222222";
const CUSTOM_ID = "33333333-3333-3333-3333-333333333333";
const LEAHYS = `custom:${CUSTOM_ID}:0`;
const market = { event_slug: "e", event_title: "E", label: "L", image: null };
const pos = (user_id: string, token_id: string, shares: string) => ({ user_id, season_id: 1, token_id, condition_id: "c", outcome_index: 0, outcome_name: "Yes", shares, cost_basis: "100.00", markets: market });

let bids: Record<string, number | null>;
const books = (ids: string[]) => Object.fromEntries(ids.filter((t) => t in bids).map((t) => [t, { tokenId: t, bestBid: bids[t] }]));
let now: number;

beforeEach(() => {
  now = 1_000_000;
  __resetMarkCache(() => now);
  fetchBooks.mockReset();
  fetchBooks.mockImplementation(async (ids: string[]) => books(ids));
  // Awkward prices on purpose so per-position rounding matters.
  bids = { tA: 0.333, tB: 0.517, tC: null, tD: 0.071 };
  db.rpcs = [];
  db.tables = {
    seasons: [{ id: 1, is_current: true, starting_balance: "10000.00" }],
    balances: [
      { user_id: ME, season_id: 1, cash: "9400.00", profiles: { display_name: "Me", deactivated_at: null } },
      { user_id: YOU, season_id: 1, cash: "5300.37", profiles: { display_name: "You", deactivated_at: null } },
    ],
    positions: [
      pos(ME, "tA", "1000.0000"),
      pos(ME, "tB", "333.3333"),
      pos(ME, "tC", "50.0000"), // no bid: worth $0 right now
      pos(ME, LEAHYS, "777.7777"),
      pos(YOU, "tB", "1234.5678"),
      pos(YOU, "tD", "9999.9999"),
      pos(YOU, "tA", "0.0000"), // sold out: not an open position
    ],
    trades: [{ token_id: "tA", kind: "buy", price: "0.400000", created_at: "2026-10-01T00:00:00Z" }],
    account_snapshots: [],
    custom_markets: [{ id: CUSTOM_ID, q: [120, 0], liquidity: "1000", status: "open", winning_index: null }],
  };
});

async function allThree(userId: string) {
  const [bar, board, page] = await Promise.all([getAccountSummary(userId), loadLeaderboard(), loadPortfolio(userId)]);
  const row = board.rows.find((r) => r.userId === userId)!;
  return { bar, row, page, board };
}

describe("account value agrees everywhere", () => {
  it("top bar, leaderboard and portfolio page show the same cash, positions and total", async () => {
    for (const user of [ME, YOU]) {
      const { bar, row, page } = await allThree(user);
      expect(row.total).toBe(bar.total);
      expect(page.total).toBe(bar.total);
      expect(row.cash).toBe(bar.cash);
      expect(page.cash).toBe(bar.cash);
      expect(row.positionsValue).toBe(bar.positionsValue);
      expect(page.positionsValue).toBe(bar.positionsValue);
      expect(row.openPositions).toBe(bar.openPositions);
      expect(page.positions.length).toBe(bar.openPositions);
      // The two parts always add up to the total shown.
      expect(Math.round((bar.cash + bar.positionsValue) * 100) / 100).toBe(bar.total);
      // The portfolio's per-position values add up to its Positions number.
      expect(Math.round(page.positions.reduce((s, p) => s + p.value, 0) * 100) / 100).toBe(page.positionsValue);
    }
  });

  it("matches a hand calculation (each position floored to the cent)", async () => {
    const { bar } = await allThree(YOU);
    // floor(1234.5678 * 0.517) = 638.27, floor(9999.9999 * 0.071) = 709.99
    expect(bar.positionsValue).toBe(1348.26);
    expect(bar.total).toBe(6648.63);
    expect(bar.openPositions).toBe(2);
    expect(bar.stale).toBe(false);
  });

  it("valueAccount ignores zero-share rows and treats no bid as $0", () => {
    expect(valueAccount(100, [{ token_id: "x", shares: "0" }, { token_id: "y", shares: 10 }], { x: 0.5, y: null })).toEqual({ cash: 100, positionsValue: 0, total: 100, openPositions: 1 });
  });
});

describe("price cache", () => {
  it("prices every surface from one Polymarket call per 30s window", async () => {
    await allThree(ME);
    await allThree(YOU);
    await getAccountSummary(ME);
    const calls = fetchBooks.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(2); // the first burst can split into overlapping batches
    now += MARK_TTL_MS - 1;
    await allThree(ME);
    expect(fetchBooks.mock.calls.length).toBe(calls);
    now += 1;
    await allThree(ME);
    expect(fetchBooks.mock.calls.length).toBe(calls + 1);
  });

  it("cash and shares are never cached: a trade shows up on the next read", async () => {
    const before = await getAccountSummary(ME);
    const calls = fetchBooks.mock.calls.length;
    db.tables.balances[0].cash = "8400.00";
    (db.tables.positions[0] as Row).shares = "4003.0030"; // bought ~$1,000 more of tA at 0.333
    const after = await getAccountSummary(ME);
    expect(after.cash).toBe(8400);
    expect(after.positionsValue).toBeCloseTo(before.positionsValue + 999.99, 2);
    expect(fetchBooks.mock.calls.length).toBe(calls); // no extra Polymarket call
  });

  it("when Polymarket fails, shows the last known value marked stale (not zero, not an error)", async () => {
    const fresh = await allThree(ME);
    fetchBooks.mockRejectedValue(new Error("502 from clob.polymarket.com"));
    now += MARK_TTL_MS * 10;
    const { bar, row, page, board } = await allThree(ME);
    expect(bar.total).toBe(fresh.bar.total);
    expect(row.total).toBe(bar.total);
    expect(page.total).toBe(bar.total);
    expect(bar.stale && board.stale && page.pricesStale).toBe(true);
    expect(bar.asOf).toBe(1_000_000);
  });

  it("on a fresh server with Polymarket down, falls back to the last Birdly trade price", async () => {
    fetchBooks.mockRejectedValue(new Error("timeout"));
    const { bar, row, page } = await allThree(ME);
    expect(bar.stale).toBe(true);
    expect(bar.positionsValue).toBeGreaterThan(400); // tA at its last trade price 0.40, not $0
    expect(row.total).toBe(bar.total);
    expect(page.total).toBe(bar.total);
  });
});
