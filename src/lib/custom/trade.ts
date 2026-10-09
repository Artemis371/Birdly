import { trading } from "@/config/site";
import { quoteLmsrBuy, quoteLmsrSell } from "@/lib/lmsr/lmsr";
import { signToken, verifyToken } from "@/lib/signing";
import type { Quote } from "@/lib/trading/quote";
import { type CustomMarket, customTokenId } from "./types";

// Quote -> confirm -> execute for custom (LMSR) markets. Same shape and rules
// as Polymarket trades: server-side pricing, signed single-use 60s quotes, and
// the final price check happens inside the database transaction against the
// locked market state (execute_custom_trade), never against client input.

export const CUSTOM_QUOTE_TTL_SEC = 60;
const PURPOSE = "custom-quote";

type OkQuote = Extract<Quote, { ok: true }>;
export type CustomTradeRequest = { slug: string; outcomeIndex: number; side: "buy" | "sell"; amount: number };
type Payload = { m: string; s: string; i: number; side: "buy" | "sell"; amount: number; u: string; avg: number; jti: string };

export type CustomTradeDeps = {
  secret: string;
  now?: () => number;
  newId: () => string;
  claimQuote: (jti: string) => Promise<boolean>;
  getMarket: (slug: string) => Promise<CustomMarket | null>;
  sharesOwned: (userId: string, tokenId: string) => Promise<number>;
  execute: (a: { userId: string; marketId: string; index: number; side: "buy" | "sell"; amount: number; refAvg: number }) => Promise<
    { ok: true; cash: number; shares: number; total: number; avg: number; prices: number[] } | { ok: false; code: string }
  >;
};

export type CustomQuoteResponse = { quote: OkQuote; token: string; expiresAt: number; outcomeName: string; label: string };
export type CustomTradeError = { ok: false; status: number; code: string; error: string; quote?: CustomQuoteResponse };

const ERRORS: Record<string, string> = {
  insufficient_funds: "Not enough paper cash for that.",
  insufficient_shares: "You don't have that many shares to sell.",
  account_inactive: "Your account is deactivated.",
  market_resolved: "This market has already been resolved.",
  market_cancelled: "This market was cancelled and everyone was refunded.",
  market_ended: "Trading on this market has closed. Waiting for the admin to pick the winner.",
  not_found: "That market wasn't found.",
  amount_too_small: "Amount too small to fill.",
  nothing_to_sell: "You don't own any shares of this outcome.",
  price_moved: "The price moved since your quote. Check the new price and confirm again.",
};

const err = (status: number, code: string, error = ERRORS[code] ?? "Something went wrong. Please try again."): CustomTradeError => ({ ok: false, status, code, error });

function valid(r: Partial<CustomTradeRequest>): r is CustomTradeRequest {
  return (
    typeof r.slug === "string" && /^[a-z0-9-]{1,80}$/.test(r.slug) &&
    Number.isInteger(r.outcomeIndex) && (r.outcomeIndex as number) >= 0 && (r.outcomeIndex as number) < 12 &&
    (r.side === "buy" || r.side === "sell") &&
    typeof r.amount === "number" && Number.isFinite(r.amount) && r.amount > 0 && r.amount <= 1e7
  );
}

function tradable(m: CustomMarket | null, index: number): CustomTradeError | null {
  if (!m || m.status === "draft") return err(404, "not_found");
  if (m.status === "resolved") return err(409, "market_resolved");
  if (m.status === "cancelled") return err(409, "market_cancelled");
  if (m.ended) return err(409, "market_ended");
  if (index >= m.outcomes.length) return err(404, "not_found", "That outcome wasn't found.");
  return null;
}

export async function getCustomQuote(userId: string, raw: Partial<CustomTradeRequest>, deps: CustomTradeDeps): Promise<({ ok: true } & CustomQuoteResponse) | CustomTradeError> {
  if (!valid(raw)) return err(400, "bad_request", "That trade request doesn't look right.");
  const m = await deps.getMarket(raw.slug);
  const blocked = tradable(m, raw.outcomeIndex);
  if (blocked || !m) return blocked ?? err(404, "not_found");

  let amount = raw.amount;
  if (raw.side === "sell") {
    const owned = await deps.sharesOwned(userId, customTokenId(m.id, raw.outcomeIndex));
    if (owned <= 0) return err(409, "nothing_to_sell");
    amount = Math.min(amount, owned);
  }
  const q = raw.side === "buy" ? quoteLmsrBuy(m.q, m.liquidity, raw.outcomeIndex, amount, trading) : quoteLmsrSell(m.q, m.liquidity, raw.outcomeIndex, amount, trading);
  if (!q.ok) return err(409, q.reason);

  const now = deps.now?.() ?? Date.now();
  const payload: Payload = { m: m.id, s: m.slug, i: raw.outcomeIndex, side: raw.side, amount, u: userId, avg: q.avgPrice, jti: deps.newId() };
  return {
    ok: true,
    quote: q,
    token: signToken(payload, PURPOSE, deps.secret, CUSTOM_QUOTE_TTL_SEC, now),
    expiresAt: now + CUSTOM_QUOTE_TTL_SEC * 1000,
    outcomeName: m.outcomes[raw.outcomeIndex],
    label: m.title,
  };
}

export async function executeCustomQuote(
  userId: string,
  token: unknown,
  deps: CustomTradeDeps,
): Promise<{ ok: true; cash: number; filled: OkQuote; prices: number[] } | CustomTradeError> {
  const now = deps.now?.() ?? Date.now();
  const p = verifyToken<Payload>(token, PURPOSE, deps.secret, now);
  if (!p) return err(400, "quote_expired", "That quote expired. Here's a fresh one.");
  if (p.u !== userId) return err(403, "forbidden", "That quote belongs to someone else.");
  if (!(await deps.claimQuote(p.jti))) return err(409, "quote_used", "That order was already submitted.");

  const m = await deps.getMarket(p.s);
  const blocked = tradable(m, p.i);
  if (blocked || !m || m.id !== p.m) return blocked ?? err(404, "not_found");

  const r = await deps.execute({ userId, marketId: m.id, index: p.i, side: p.side, amount: p.amount, refAvg: p.avg });
  if (!r.ok) {
    if (r.code === "price_moved") {
      const requote = await getCustomQuote(userId, { slug: p.s, outcomeIndex: p.i, side: p.side, amount: p.amount }, deps);
      const e = err(409, "price_moved");
      if (requote.ok) e.quote = { quote: requote.quote, token: requote.token, expiresAt: requote.expiresAt, outcomeName: requote.outcomeName, label: requote.label };
      return e;
    }
    return err(r.code === "insufficient_funds" || r.code === "insufficient_shares" || r.code === "market_ended" ? 409 : 500, r.code);
  }
  const filled: OkQuote = {
    ok: true,
    side: p.side,
    shares: r.shares,
    total: r.total,
    avgPrice: r.avg,
    bestPrice: m.prices[p.i],
    worstPrice: r.prices[p.i],
    payoutIfWin: p.side === "buy" ? Math.floor(r.shares * 100) / 100 : 0,
    capped: false,
    capReason: null,
    fills: [],
  };
  return { ok: true, cash: r.cash, filled, prices: r.prices };
}
