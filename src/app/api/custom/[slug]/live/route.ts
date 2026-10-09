import type { NextRequest } from "next/server";
import { json } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/guard";
import { getCustomBySlug } from "@/lib/custom/markets";
import { quoteLmsrBuy, quoteLmsrSell } from "@/lib/lmsr/lmsr";
import { trading } from "@/config/site";

// Members only, never cached: current prices, plus an optional read-only
// preview quote (?i=&side=&amount=) for the trade panel.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/custom/[slug]/live">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { slug } = await ctx.params;
  const m = await getCustomBySlug(slug);
  if (!m || (m.status === "draft" && !user.isAdmin)) return json({ error: "not_found" }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const i = Number(sp.get("i"));
  const amount = Number(sp.get("amount"));
  const side = sp.get("side");
  let quote = null;
  if (Number.isInteger(i) && i >= 0 && i < m.outcomes.length && amount > 0 && amount <= 1e7 && (side === "buy" || side === "sell")) {
    quote = side === "buy" ? quoteLmsrBuy(m.q, m.liquidity, i, amount, trading) : quoteLmsrSell(m.q, m.liquidity, i, amount, trading);
  }
  return json({ prices: m.prices, status: m.status, ended: m.ended, volume: m.volume, quote });
}
