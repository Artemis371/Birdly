import type {
  BookLevel,
  ClobMarket,
  Market,
  OrderBook,
  Outcome,
  PolyEvent,
  PricePoint,
  ResolutionStatus,
  Tag,
} from "./types";

type Raw = Record<string, unknown>;

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function bool(v: unknown): boolean {
  return v === true || v === "true";
}

// Gamma mixes ISO timestamps ("2026-10-09T00:15:00Z") with Postgres-style ones
// ("2026-10-08 18:38:29+00", seen live on closedTime). Normalize to ISO.
export function isoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const pg = s.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/);
  const candidate = pg ? `${pg[1]}T${pg[2]}${pg[3]}:${pg[4] ?? "00"}` : s;
  const ms = Date.parse(candidate);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// Gamma returns outcomes, outcomePrices and clobTokenIds as JSON-encoded
// strings (e.g. "[\"Yes\",\"No\"]"). Accept real arrays too in case that changes.
export function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== "string" || v.trim() === "") return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const RESOLUTION_STATUSES = new Set(["requested", "proposed", "disputed", "resolved", "settled"]);

function resolutionStatus(v: unknown): ResolutionStatus {
  return typeof v === "string" && RESOLUTION_STATUSES.has(v) ? (v as ResolutionStatus) : null;
}

export function parseMarket(raw: Raw): Market | null {
  const conditionId = str(raw.conditionId);
  const id = raw.id != null ? String(raw.id) : null;
  if (!id || !conditionId) return null;

  const names = parseJsonArray(raw.outcomes);
  const prices = parseJsonArray(raw.outcomePrices);
  const tokens = parseJsonArray(raw.clobTokenIds);
  // Undeployed template markets come back with null token ids (seen live); skip them.
  if (tokens.length < 2) return null;
  // Names are usually Yes/No but sports markets use team names (confirmed live).
  const outcomes: Outcome[] = tokens.map((tokenId, i) => ({
    name: names[i] ?? (i === 0 ? "Yes" : "No"),
    tokenId,
    price: num(prices[i]),
  }));

  const question = str(raw.question) ?? "";
  return {
    id,
    conditionId,
    slug: str(raw.slug) ?? id,
    question,
    label: str(raw.groupItemTitle) ?? question,
    image: str(raw.image) ?? str(raw.icon),
    outcomes,
    endDate: isoDate(raw.endDate) ?? isoDate(raw.endDateIso),
    active: bool(raw.active),
    closed: bool(raw.closed),
    archived: bool(raw.archived),
    acceptingOrders: bool(raw.acceptingOrders),
    enableOrderBook: bool(raw.enableOrderBook),
    negRisk: bool(raw.negRisk),
    bestBid: num(raw.bestBid),
    bestAsk: num(raw.bestAsk),
    volume: num(raw.volumeNum) ?? num(raw.volume) ?? 0,
    volume24hr: num(raw.volume24hr) ?? 0,
    liquidity: num(raw.liquidityNum) ?? num(raw.liquidity) ?? 0,
    oneDayPriceChange: num(raw.oneDayPriceChange),
    umaResolutionStatus: resolutionStatus(raw.umaResolutionStatus),
    closedTime: isoDate(raw.closedTime),
  };
}

function parseTags(v: unknown): Tag[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((t: Raw) => ({
      id: t?.id != null ? String(t.id) : "",
      label: str(t?.label) ?? "",
      slug: str(t?.slug) ?? "",
    }))
    .filter((t) => t.slug);
}

export function parseEvent(raw: Raw): PolyEvent | null {
  const id = raw.id != null ? String(raw.id) : null;
  const slug = str(raw.slug);
  if (!id || !slug) return null;
  const markets = Array.isArray(raw.markets)
    ? (raw.markets as Raw[]).map(parseMarket).filter((m): m is Market => m !== null)
    : [];
  return {
    id,
    slug,
    title: str(raw.title) ?? slug,
    description: str(raw.description) ?? "",
    image: str(raw.image) ?? str(raw.icon),
    endDate: isoDate(raw.endDate),
    startDate: isoDate(raw.startDate),
    createdAt: isoDate(raw.createdAt),
    active: bool(raw.active),
    closed: bool(raw.closed),
    negRisk: bool(raw.negRisk) || bool(raw.enableNegRisk),
    volume: num(raw.volume) ?? 0,
    volume24hr: num(raw.volume24hr) ?? 0,
    liquidity: num(raw.liquidity) ?? 0,
    tags: parseTags(raw.tags),
    markets,
  };
}

function parseLevels(v: unknown): BookLevel[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((l: Raw) => ({ price: num(l?.price) ?? NaN, size: num(l?.size) ?? NaN }))
    .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size) && l.size > 0 && l.price > 0 && l.price < 1);
}

// CLOB /book returns both sides sorted worst-to-best (best price LAST), confirmed
// live. We sort ourselves anyway: best bid = highest bid, best ask = lowest ask.
export function parseBook(raw: Raw, tokenId: string): OrderBook {
  const bids = parseLevels(raw.bids).sort((a, b) => b.price - a.price);
  const asks = parseLevels(raw.asks).sort((a, b) => a.price - b.price);
  const ts = num(raw.timestamp);
  return {
    tokenId: str(raw.asset_id) ?? tokenId,
    conditionId: str(raw.market),
    bids,
    asks,
    bestBid: bids[0]?.price ?? null,
    bestAsk: asks[0]?.price ?? null,
    tickSize: num(raw.tick_size),
    minOrderSize: num(raw.min_order_size),
    timestamp: ts,
  };
}

// Confirmed live: { history: [{ t: unixSeconds, p: number }] }. The official TS
// client types it as a bare array, so accept both.
export function parseHistory(raw: unknown): PricePoint[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as Raw)?.history) ? ((raw as Raw).history as unknown[]) : [];
  const points: PricePoint[] = [];
  for (const item of arr as Raw[]) {
    const t = num(item?.t);
    const p = num(item?.p);
    if (t !== null && p !== null) points.push({ t: Math.floor(t), p });
  }
  points.sort((a, b) => a.t - b.t);
  // Charts need strictly increasing timestamps.
  return points.filter((pt, i) => i === 0 || pt.t > points[i - 1].t);
}

// CLOB GET /markets/{conditionId}. Confirmed live: on a normal resolution one
// token has winner=true and price 1; on a 50/50 resolution BOTH tokens have
// winner=false and price 0.5, so `winner` alone can't drive payouts.
export function parseClobMarket(raw: Raw): ClobMarket | null {
  const conditionId = str(raw.condition_id);
  if (!conditionId || !Array.isArray(raw.tokens)) return null;
  const tokens = (raw.tokens as Raw[])
    .map((t) => ({
      tokenId: t?.token_id != null ? String(t.token_id) : "",
      outcome: str(t?.outcome) ?? "",
      price: num(t?.price),
      winner: t?.winner === true,
    }))
    .filter((t) => t.tokenId);
  return {
    conditionId,
    active: bool(raw.active),
    closed: bool(raw.closed),
    acceptingOrders: bool(raw.accepting_orders),
    enableOrderBook: bool(raw.enable_order_book),
    tokens,
  };
}
