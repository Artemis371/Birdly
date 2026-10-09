import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { currentSeasonId } from "@/lib/trading/deps";
import type { OutcomeExposure } from "@/components/custom/ResolveCustom";
import { type CustomMarket, customConditionId, parseCustomToken } from "./types";

// Shares and holders per outcome, for the resolve page's payout preview.
export async function exposureByOutcome(m: CustomMarket): Promise<OutcomeExposure[]> {
  const out: OutcomeExposure[] = m.outcomes.map(() => ({ holders: 0, shares: 0 }));
  const { data } = await adminClient()
    .from("positions")
    .select("token_id, shares")
    .eq("condition_id", customConditionId(m.id))
    .eq("season_id", await currentSeasonId())
    .gt("shares", 0);
  for (const p of data ?? []) {
    const t = parseCustomToken(p.token_id);
    if (t && out[t.index]) {
      out[t.index].holders++;
      out[t.index].shares += Number(p.shares);
    }
  }
  return out;
}

export type RefundLine = { displayName: string; refund: number };

// What each person would get back if this market were cancelled:
// max(0, total paid in buys - total received from sells). Mirrors
// cancel_custom_market in SQL.
export async function refundPreview(m: CustomMarket): Promise<RefundLine[]> {
  const { data } = await adminClient()
    .from("trades")
    .select("user_id, kind, amount, profiles!inner(display_name)")
    .eq("condition_id", customConditionId(m.id))
    .eq("season_id", await currentSeasonId())
    .in("kind", ["buy", "sell"])
    .limit(10000);
  const net = new Map<string, { name: string; cents: number }>();
  type R = { user_id: string; kind: "buy" | "sell"; amount: string; profiles: { display_name: string } };
  for (const t of (data ?? []) as unknown as R[]) {
    const e = net.get(t.user_id) ?? { name: t.profiles.display_name, cents: 0 };
    e.cents += Math.round(Number(t.amount) * 100) * (t.kind === "buy" ? 1 : -1);
    net.set(t.user_id, e);
  }
  return [...net.values()]
    .map((e) => ({ displayName: e.name, refund: Math.max(0, e.cents) / 100 }))
    .sort((a, b) => b.refund - a.refund || a.displayName.localeCompare(b.displayName));
}
