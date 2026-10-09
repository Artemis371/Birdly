import type { NextRequest } from "next/server";
import { TOKEN_RE, json } from "@/lib/api-response";
import { getBooks } from "@/lib/polymarket/api";
import { quoteBuy, quoteSell } from "@/lib/trading/quote";

// Phase 1: read-only quote preview from the real book. In Phase 2 the trade
// route re-quotes against a FRESH book at execution and ignores client prices.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const token = sp.get("token") ?? "";
  const side = sp.get("side");
  const amount = Number(sp.get("amount"));
  if (!TOKEN_RE.test(token) || (side !== "buy" && side !== "sell") || !Number.isFinite(amount) || amount <= 0 || amount > 1e7) {
    return json({ error: "bad_request" }, { status: 400 });
  }
  try {
    const books = await getBooks([token]);
    const book = books.data[token];
    if (!book) return json({ quote: { ok: false, reason: "no_quote" }, stale: books.stale });
    const quote = side === "buy" ? quoteBuy(book, amount) : quoteSell(book, amount);
    return json({ quote, stale: books.stale, fetchedAt: books.fetchedAt }, { sMaxAge: 3 });
  } catch {
    return json({ error: "upstream_unavailable" }, { status: 503 });
  }
}
