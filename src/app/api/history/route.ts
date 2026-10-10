import type { NextRequest } from "next/server";
import { cacheTtl } from "@/config/site";
import { TOKEN_RE, json } from "@/lib/api-response";
import { getHistory } from "@/lib/polymarket/api";
import type { ChartRange } from "@/lib/polymarket/types";

const RANGES = new Set<ChartRange>(["1H", "1D", "1W", "1M", "ALL"]);

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const range = (req.nextUrl.searchParams.get("range") ?? "1D") as ChartRange;
  if (!TOKEN_RE.test(token) || !RANGES.has(range)) return json({ error: "bad_request" }, { status: 400 });
  try {
    const h = await getHistory(token, range);
    return json({ points: h.data, stale: h.stale, fetchedAt: h.fetchedAt }, { sMaxAge: cacheTtl.cdnHistory });
  } catch {
    return json({ error: "upstream_unavailable" }, { status: 503 });
  }
}
