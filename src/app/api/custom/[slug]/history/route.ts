import type { NextRequest } from "next/server";
import { json } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/guard";
import { customHistory, getCustomBySlug } from "@/lib/custom/markets";
import type { ChartRange } from "@/lib/polymarket/types";

const RANGES = new Set<ChartRange>(["1H", "1D", "1W", "1M", "ALL"]);

export async function GET(req: NextRequest, ctx: RouteContext<"/api/custom/[slug]/history">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { slug } = await ctx.params;
  const i = Number(req.nextUrl.searchParams.get("i"));
  const range = (req.nextUrl.searchParams.get("range") ?? "ALL") as ChartRange;
  const m = await getCustomBySlug(slug);
  if (!m || (m.status === "draft" && !user.isAdmin)) return json({ error: "not_found" }, { status: 404 });
  if (!Number.isInteger(i) || i < 0 || i >= m.outcomes.length || !RANGES.has(range)) return json({ error: "bad_request" }, { status: 400 });
  return json({ points: await customHistory(m, i, range), stale: false });
}
