import { json } from "@/lib/api-response";
import { readJson, requireUser } from "@/lib/auth/guard";
import { customTradeDeps } from "@/lib/custom/deps";
import { executeCustomQuote } from "@/lib/custom/trade";
import { tradeLimit } from "@/lib/trading/deps";

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!(await tradeLimit(user.id))) return json({ error: "Slow down a little. Too many trades in the last minute." }, { status: 429 });
  const r = await executeCustomQuote(user.id, (await readJson(req)).token, customTradeDeps());
  return r.ok ? json(r) : json(r, { status: r.status });
}
