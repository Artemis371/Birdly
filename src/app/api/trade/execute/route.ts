import { json } from "@/lib/api-response";
import { readJson, requireUser } from "@/lib/auth/guard";
import { executeQuote } from "@/lib/trading/execute";
import { tradeDeps, tradeLimit } from "@/lib/trading/deps";

// Executes a previously issued quote against a FRESH order book.
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!(await tradeLimit(user.id))) return json({ error: "Slow down a little. Too many trades in the last minute." }, { status: 429 });
  const b = await readJson(req);
  const r = await executeQuote(user.id, b.token, tradeDeps());
  return r.ok ? json(r) : json(r, { status: r.status });
}
