import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { currentSeasonId } from "@/lib/trading/deps";

export type Holder = { displayName: string; conditionId: string; tokenId: string; outcomeName: string; shares: number; isYou: boolean };

// Everyone in the group with an open position in these markets. Display names
// only; never emails. Only shown to signed-in members.
export async function loadHolders(conditionIds: string[], viewerId: string): Promise<Holder[]> {
  if (!conditionIds.length) return [];
  const season = await currentSeasonId();
  const { data, error } = await adminClient()
    .from("positions")
    .select("user_id, condition_id, token_id, outcome_name, shares, profiles!inner(display_name, deactivated_at)")
    .eq("season_id", season)
    .in("condition_id", conditionIds.slice(0, 200))
    .gt("shares", 0)
    .order("shares", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[holders]", error.message);
    return [];
  }
  type Row = { user_id: string; condition_id: string; token_id: string; outcome_name: string; shares: string; profiles: { display_name: string; deactivated_at: string | null } };
  return (data as unknown as Row[])
    .filter((r) => !r.profiles.deactivated_at)
    .map((r) => ({
      displayName: r.profiles.display_name,
      conditionId: r.condition_id,
      tokenId: r.token_id,
      outcomeName: r.outcome_name,
      shares: Number(r.shares),
      isYou: r.user_id === viewerId,
    }));
}
