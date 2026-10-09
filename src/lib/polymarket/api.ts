import "server-only";
import { cacheTtl } from "@/config/site";
import { CLOB, GAMMA, cached, getJson } from "./client";
import { parseBook, parseClobMarket, parseEvent, parseHistory, parseMarket } from "./parse";
import type { ChartRange, ClobMarket, Fetched, Market, OrderBook, PolyEvent, PricePoint } from "./types";

// Every Polymarket endpoint and query parameter Birdly uses lives in this file,
// all verified against live responses on 2026-10-09 (see docs/API_NOTES.md).

export type SortKey = "trending" | "volume" | "ending" | "new";
export const SORTS: { key: SortKey; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "volume", label: "Volume" },
  { key: "ending", label: "Ending soon" },
  { key: "new", label: "New" },
];

const PAGE_SIZE = 24; // Gamma caps keyset pages at 100
// Polymarket tags its 5/15-minute crypto up/down spam "hide-from-new" (id 102169).
const HIDE_FROM_NEW_TAG_ID = "102169";

type Raw = Record<string, unknown>;

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v));
  return sp.toString();
}

function parseEvents(list: unknown): PolyEvent[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((e) => parseEvent(e as Raw))
    .filter((e): e is PolyEvent => e !== null && !e.closed && e.markets.some((m) => !m.closed));
}

export type EventPage = { events: PolyEvent[]; nextCursor: string | null };

// GET /events/keyset. The offset-based /events is deprecated (Sunset header, live).
export function listEvents(opts: { sort?: SortKey; tag?: string; cursor?: string }): Promise<Fetched<EventPage>> {
  const sort = opts.sort ?? "trending";
  const params: Record<string, string | number | undefined> = {
    closed: "false",
    limit: PAGE_SIZE,
    tag_slug: opts.tag || undefined,
    after_cursor: opts.cursor,
  };
  if (sort === "trending") Object.assign(params, { order: "volume24hr", ascending: "false" });
  if (sort === "volume") Object.assign(params, { order: "volume", ascending: "false" });
  if (sort === "ending")
    Object.assign(params, {
      order: "endDate",
      ascending: "true",
      // Without this, Gamma returns long-expired markets that were never closed.
      end_date_min: new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString(),
      exclude_tag_id: HIDE_FROM_NEW_TAG_ID,
    });
  if (sort === "new")
    Object.assign(params, { order: "createdAt", ascending: "false", exclude_tag_id: HIDE_FROM_NEW_TAG_ID, liquidity_min: 1000 });

  const query = qs(params);
  return cached(`events:${query}`, cacheTtl.eventList, async () => {
    const raw = (await getJson(`${GAMMA}/events/keyset?${query}`)) as Raw;
    return {
      events: parseEvents(raw.events),
      nextCursor: typeof raw.next_cursor === "string" && raw.next_cursor ? raw.next_cursor : null,
    };
  });
}

// GET /public-search. Returns events with nested markets.
export function searchEvents(q: string): Promise<Fetched<EventPage>> {
  const query = qs({ q: q.trim().slice(0, 100), limit_per_type: PAGE_SIZE, events_status: "active" });
  return cached(`search:${query}`, cacheTtl.eventList, async () => {
    const raw = (await getJson(`${GAMMA}/public-search?${query}`)) as Raw;
    return { events: parseEvents(raw.events), nextCursor: null };
  });
}

// GET /events/slug/{slug}. Returns null for unknown slugs.
export function getEvent(slug: string): Promise<Fetched<PolyEvent | null>> {
  return cached(`event:${slug}`, cacheTtl.event, async () => {
    try {
      return parseEvent((await getJson(`${GAMMA}/events/slug/${encodeURIComponent(slug)}`)) as Raw);
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  });
}

// POST /books. Live behavior: unknown/resolved tokens are silently dropped and
// response order doesn't match request order, so we key by asset_id.
async function fetchBooks(tokenIds: string[]): Promise<Record<string, OrderBook>> {
  const out: Record<string, OrderBook> = {};
  for (let i = 0; i < tokenIds.length; i += 50) {
    const chunk = tokenIds.slice(i, i + 50);
    const raw = await getJson(`${CLOB}/books`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chunk.map((token_id) => ({ token_id }))),
    });
    if (Array.isArray(raw)) {
      for (const b of raw as Raw[]) {
        const book = parseBook(b, String(b.asset_id ?? ""));
        if (book.tokenId) out[book.tokenId] = book;
      }
    }
  }
  return out;
}

export function getBooks(tokenIds: string[]): Promise<Fetched<Record<string, OrderBook>>> {
  const ids = [...new Set(tokenIds)].sort();
  return cached(`books:${ids.join(",")}`, cacheTtl.book, () => fetchBooks(ids));
}

// Fresh book straight from the CLOB, bypassing every cache. For trade execution.
// GET /book returns 404 once a market has resolved; that maps to null.
export async function getFreshBook(tokenId: string): Promise<OrderBook | null> {
  try {
    return parseBook((await getJson(`${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`)) as Raw, tokenId);
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

// GET /prices-history. Live limits: explicit startTs+endTs windows over 15 days
// are rejected, so 1M uses interval=1m (one month) instead.
const RANGE_PARAMS: Record<ChartRange, { interval: string; fidelity: number }> = {
  "1H": { interval: "1h", fidelity: 1 },
  "1D": { interval: "1d", fidelity: 5 },
  "1W": { interval: "1w", fidelity: 30 },
  "1M": { interval: "1m", fidelity: 180 },
  ALL: { interval: "max", fidelity: 720 },
};

export function getHistory(tokenId: string, range: ChartRange): Promise<Fetched<PricePoint[]>> {
  const { interval, fidelity } = RANGE_PARAMS[range];
  const query = qs({ market: tokenId, interval, fidelity });
  return cached(`history:${query}`, cacheTtl.history, async () => parseHistory(await getJson(`${CLOB}/prices-history?${query}`)));
}

// GET /markets/{conditionId} on the CLOB. Used by resolution (Phase 3).
export function getClobMarket(conditionId: string): Promise<Fetched<ClobMarket | null>> {
  return cached(`clob-market:${conditionId}`, cacheTtl.event, async () =>
    parseClobMarket((await getJson(`${CLOB}/markets/${encodeURIComponent(conditionId)}`)) as Raw),
  );
}

// Fresh (uncached) lookups for resolution. Live behavior: condition_ids must be
// repeated (comma-separated returns nothing), and Gamma only returns open
// markets unless closed=true, so ask for both.
export async function fetchGammaMarketsByCondition(conditionIds: string[]): Promise<Map<string, Market>> {
  const out = new Map<string, Market>();
  for (let i = 0; i < conditionIds.length; i += 40) {
    const chunk = conditionIds.slice(i, i + 40);
    for (const closed of ["true", "false"]) {
      const sp = new URLSearchParams({ closed, limit: "100" });
      for (const id of chunk) sp.append("condition_ids", id);
      const raw = (await getJson(`${GAMMA}/markets/keyset?${sp}`)) as Raw;
      for (const r of (Array.isArray(raw.markets) ? raw.markets : []) as Raw[]) {
        const m = parseMarket(r);
        if (m) out.set(m.conditionId, m);
      }
    }
  }
  return out;
}

export async function fetchClobMarket(conditionId: string): Promise<ClobMarket | null> {
  try {
    return parseClobMarket((await getJson(`${CLOB}/markets/${encodeURIComponent(conditionId)}`)) as Raw);
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}
