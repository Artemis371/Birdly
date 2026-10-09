import { trading } from "@/config/site";
import { marketBlockReason } from "@/lib/polymarket/display";
import type { Market, OrderBook, PolyEvent } from "@/lib/polymarket/types";
import { signToken, verifyToken } from "@/lib/signing";
import { priceMovedTooMuch, quoteBuy, quoteSell, type Quote } from "./quote";

// Quote-then-execute, with every side effect injected so the rules are
// testable. The ONLY price that ever reaches the database comes from a fresh
// order book fetched here at execution time. The client sends back a signed
// quote token, which is used solely as the reference for the "price moved"
// check, never as a fill price.

export const QUOTE_TTL_SEC = 60;
const PURPOSE = "quote";

export type TradeRequest = {
  slug: string;
  conditionId: string;
  outcomeIndex: 0 | 1;
  side: "buy" | "sell";
  amount: number; // dollars for buys, shares for sells
};

type QuotePayload = TradeRequest & { u: string; avg: number; jti: string };

export type TradeDeps = {
  secret: string;
  now?: () => number;
  getEvent: (slug: string) => Promise<{ data: PolyEvent | null; stale: boolean }>;
  getFreshBook: (tokenId: string) => Promise<OrderBook | null>;
  sharesOwned: (userId: string, tokenId: string) => Promise<number>;
  // Returns false if this quote id was already used (stops double-submits).
  claimQuote: (jti: string) => Promise<boolean>;
  newId: () => string;
  executeTrade: (args: {
    userId: string;
    side: "buy" | "sell";
    tokenId: string;
    shares: number;
    amount: number;
    price: number;
    market: Record<string, unknown>;
  }) => Promise<{ ok: true; cash: number; shares: number; tradeId: number } | { ok: false; code: string }>;
};

export type TradeError = { ok: false; status: number; code: string; error: string; quote?: QuoteResponse };
export type QuoteResponse = { quote: Extract<Quote, { ok: true }>; token: string; expiresAt: number; outcomeName: string; label: string };

const ERRORS: Record<string, string> = {
  insufficient_funds: "Not enough paper cash for that.",
  trade_too_large: "That's over the per-trade maximum.",
  insufficient_shares: "You don't have that many shares to sell.",
  account_inactive: "Your account is deactivated.",
  market_resolved: "This market has already resolved.",
  no_quote: "No one is offering a price on this side right now, so it can't be traded.",
  price_out_of_range: "This outcome is priced at the extreme (basically decided), so trading is blocked.",
  amount_too_small: "Amount too small to fill.",
  nothing_to_sell: "You don't own any shares of this outcome.",
};

function err(status: number, code: string, error = ERRORS[code] ?? "Something went wrong. Please try again."): TradeError {
  return { ok: false, status, code, error };
}

function validRequest(r: Partial<TradeRequest>): r is TradeRequest {
  return (
    typeof r.slug === "string" && r.slug.length > 0 && r.slug.length < 300 &&
    typeof r.conditionId === "string" && /^0x[0-9a-fA-F]{1,128}$/.test(r.conditionId) &&
    (r.outcomeIndex === 0 || r.outcomeIndex === 1) &&
    (r.side === "buy" || r.side === "sell") &&
    typeof r.amount === "number" && Number.isFinite(r.amount) && r.amount > 0 && r.amount <= 1e7
  );
}

async function resolveMarket(req: TradeRequest, deps: TradeDeps): Promise<{ ev: PolyEvent; m: Market; tokenId: string } | TradeError> {
  let ev;
  try {
    ev = await deps.getEvent(req.slug);
  } catch {
    return err(503, "upstream", "Live market data is unavailable right now, so trading is paused.");
  }
  if (ev.stale) return err(503, "stale", "Live market data is delayed right now, so trading is paused.");
  const m = ev.data?.markets.find((x) => x.conditionId === req.conditionId);
  if (!ev.data || !m) return err(404, "not_found", "That market wasn't found.");
  const blocked = marketBlockReason(m);
  if (blocked) return err(409, "blocked", blocked);
  const tokenId = m.outcomes[req.outcomeIndex]?.tokenId;
  if (!tokenId) return err(404, "not_found", "That outcome wasn't found.");
  return { ev: ev.data, m, tokenId };
}

async function priceIt(userId: string, req: TradeRequest, tokenId: string, deps: TradeDeps) {
  let book: OrderBook | null;
  try {
    book = await deps.getFreshBook(tokenId);
  } catch {
    return err(503, "upstream", "Couldn't get a live price right now. Try again in a moment.");
  }
  if (!book) return err(409, "no_quote");
  let amount = req.amount;
  if (req.side === "sell") {
    const owned = await deps.sharesOwned(userId, tokenId);
    if (owned <= 0) return err(409, "nothing_to_sell");
    amount = Math.min(amount, owned);
  }
  const q = req.side === "buy" ? quoteBuy(book, amount) : quoteSell(book, amount);
  if (!q.ok) return err(409, q.reason);
  return { quote: q, amount };
}

export async function getQuote(userId: string, raw: Partial<TradeRequest>, deps: TradeDeps): Promise<({ ok: true } & QuoteResponse) | TradeError> {
  if (!validRequest(raw)) return err(400, "bad_request", "That trade request doesn't look right.");
  const resolved = await resolveMarket(raw, deps);
  if ("ok" in resolved) return resolved;
  const priced = await priceIt(userId, raw, resolved.tokenId, deps);
  if ("ok" in priced) return priced;
  const now = deps.now?.() ?? Date.now();
  const payload: QuotePayload = { ...raw, amount: priced.amount, u: userId, avg: priced.quote.avgPrice, jti: deps.newId() };
  return {
    ok: true,
    quote: priced.quote,
    token: signToken(payload, PURPOSE, deps.secret, QUOTE_TTL_SEC, now),
    expiresAt: now + QUOTE_TTL_SEC * 1000,
    outcomeName: resolved.m.outcomes[raw.outcomeIndex].name,
    label: resolved.m.label,
  };
}

export async function executeQuote(
  userId: string,
  token: unknown,
  deps: TradeDeps,
): Promise<{ ok: true; cash: number; shares: number; tradeId: number; filled: Extract<Quote, { ok: true }> } | TradeError> {
  const now = deps.now?.() ?? Date.now();
  const signed = verifyToken<QuotePayload>(token, PURPOSE, deps.secret, now);
  if (!signed) return err(400, "quote_expired", "That quote expired. Here's a fresh one.");
  if (signed.u !== userId) return err(403, "forbidden", "That quote belongs to someone else.");
  if (!(await deps.claimQuote(signed.jti))) return err(409, "quote_used", "That order was already submitted.");
  const req: TradeRequest = { slug: signed.slug, conditionId: signed.conditionId, outcomeIndex: signed.outcomeIndex, side: signed.side, amount: signed.amount };
  if (!validRequest(req)) return err(400, "bad_request");

  const resolved = await resolveMarket(req, deps);
  if ("ok" in resolved) return resolved;
  const priced = await priceIt(userId, req, resolved.tokenId, deps);
  if ("ok" in priced) return priced;
  const fresh = priced.quote;

  if (priceMovedTooMuch(signed.avg, fresh.avgPrice, req.side, trading.quoteTolerance)) {
    const requote = await getQuote(userId, req, deps);
    const e = err(409, "price_moved", "The price moved since your quote. Check the new price and confirm again.");
    if (requote.ok) e.quote = { quote: requote.quote, token: requote.token, expiresAt: requote.expiresAt, outcomeName: requote.outcomeName, label: requote.label };
    return e;
  }

  const { ev, m, tokenId } = resolved;
  const result = await deps.executeTrade({
    userId,
    side: req.side,
    tokenId,
    shares: fresh.shares,
    amount: fresh.total,
    price: Number(fresh.avgPrice.toFixed(6)),
    market: {
      condition_id: m.conditionId,
      event_slug: ev.slug,
      event_title: ev.title,
      question: m.question,
      label: m.label,
      image: m.image ?? ev.image,
      outcomes: m.outcomes.map((o) => ({ name: o.name, token_id: o.tokenId })),
      end_date: m.endDate,
      outcome_index: req.outcomeIndex,
      outcome_name: m.outcomes[req.outcomeIndex].name,
    },
  });
  if (!result.ok) return err(result.code === "insufficient_funds" || result.code === "insufficient_shares" ? 409 : 500, result.code);
  return { ...result, filled: fresh };
}
