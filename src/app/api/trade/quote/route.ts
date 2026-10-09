import { json } from "@/lib/api-response";
import { readJson, requireUser } from "@/lib/auth/guard";
import { getQuote } from "@/lib/trading/execute";
import { tradeDeps } from "@/lib/trading/deps";

// Signed, fresh-book quote for a signed-in user. Nothing is executed here.
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = await readJson(req);
  const r = await getQuote(
    user.id,
    { slug: b.slug as string, conditionId: b.conditionId as string, outcomeIndex: b.outcomeIndex as 0 | 1, side: b.side as "buy" | "sell", amount: Number(b.amount) },
    tradeDeps(),
  );
  return r.ok ? json(r) : json(r, { status: r.status });
}
