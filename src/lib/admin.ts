import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { currentSeasonId } from "@/lib/trading/deps";

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string;
  joinedAt: string;
  lastSignInAt: string | null;
  cash: number;
  openPositions: number;
  deactivated: boolean;
};

export async function listUsers(): Promise<AdminUserRow[]> {
  const db = adminClient();
  const season = await currentSeasonId();
  const [authUsers, profiles, balances, positions] = await Promise.all([
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    db.from("profiles").select("id, display_name, created_at, deactivated_at"),
    db.from("balances").select("user_id, cash").eq("season_id", season),
    db.from("positions").select("user_id").eq("season_id", season).gt("shares", 0),
  ]);
  const emailById = new Map((authUsers.data?.users ?? []).map((u) => [u.id, u]));
  const cashById = new Map((balances.data ?? []).map((b) => [b.user_id, Number(b.cash)]));
  const posCount = new Map<string, number>();
  for (const p of positions.data ?? []) posCount.set(p.user_id, (posCount.get(p.user_id) ?? 0) + 1);
  return (profiles.data ?? [])
    .map((p) => {
      const u = emailById.get(p.id);
      return {
        id: p.id,
        email: u?.email ?? "",
        displayName: p.display_name,
        joinedAt: p.created_at,
        lastSignInAt: u?.last_sign_in_at ?? null,
        cash: cashById.get(p.id) ?? 0,
        openPositions: posCount.get(p.id) ?? 0,
        deactivated: !!p.deactivated_at,
      };
    })
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}
