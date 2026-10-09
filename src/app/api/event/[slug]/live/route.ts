import type { NextRequest } from "next/server";
import { json } from "@/lib/api-response";
import { getBooks, getEvent } from "@/lib/polymarket/api";
import { orderMarkets, toLive, type LiveResponse } from "@/lib/polymarket/display";

const MAX_MARKETS = 100;

// Live best bid/ask for every open market in an event, from real CLOB books.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/event/[slug]/live">) {
  const { slug } = await ctx.params;
  try {
    const ev = await getEvent(slug);
    if (!ev.data) return json({ error: "not_found" }, { status: 404 });
    const markets = orderMarkets(ev.data.markets, ev.data.negRisk).slice(0, MAX_MARKETS);
    const books = await getBooks(markets.flatMap((m) => m.outcomes.slice(0, 2).map((o) => o.tokenId)));
    const body: LiveResponse = {
      fetchedAt: Math.min(ev.fetchedAt, books.fetchedAt),
      stale: ev.stale || books.stale,
      markets: markets.map((m) => toLive(m, books.data)),
    };
    return json(body, { sMaxAge: 5 });
  } catch {
    return json({ error: "upstream_unavailable" }, { status: 503 });
  }
}
