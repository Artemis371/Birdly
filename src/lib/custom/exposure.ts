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
