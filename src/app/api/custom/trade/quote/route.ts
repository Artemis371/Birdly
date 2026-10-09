import { json } from "@/lib/api-response";
import { readJson, requireUser } from "@/lib/auth/guard";
import { customTradeDeps } from "@/lib/custom/deps";
import { getCustomQuote } from "@/lib/custom/trade";

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = await readJson(req);
  const r = await getCustomQuote(user.id, { slug: b.slug as string, outcomeIndex: Number(b.outcomeIndex), side: b.side as "buy" | "sell", amount: Number(b.amount) }, customTradeDeps());
  return r.ok ? json(r) : json(r, { status: r.status });
}
