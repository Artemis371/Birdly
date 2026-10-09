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

export type WaitingMarket = {
  conditionId: string;
  label: string;
  eventTitle: string;
  eventSlug: string;
  endDate: string | null;
  closed: boolean;
  lastCheckedAt: string | null;
  note: string | null;
  holders: number;
  shares: number;
};

// Markets someone still holds that haven't been paid out, for the admin
// "waiting" view. Closed or past-end-date ones are the ones that could be stuck.
export async function listWaitingMarkets(): Promise<WaitingMarket[]> {
  const db = adminClient();
  const { data: pos } = await db.from("positions").select("condition_id, user_id, shares").gt("shares", 0).limit(5000);
  const byMarket = new Map<string, { users: Set<string>; shares: number }>();
  for (const p of pos ?? []) {
    const e = byMarket.get(p.condition_id) ?? { users: new Set<string>(), shares: 0 };
    e.users.add(p.user_id);
    e.shares += Number(p.shares);
    byMarket.set(p.condition_id, e);
  }
  if (!byMarket.size) return [];
  const { data: markets } = await db
    .from("markets")
    .select("condition_id, label, event_title, event_slug, end_date, polymarket_closed, last_checked_at, resolution_note")
    .eq("source", "polymarket")
    .is("resolved_at", null)
    .in("condition_id", [...byMarket.keys()].slice(0, 500));
  const now = Date.now();
  return (markets ?? [])
    .filter((m) => m.polymarket_closed || (m.end_date && Date.parse(m.end_date) < now))
    .map((m) => ({
      conditionId: m.condition_id,
      label: m.label,
      eventTitle: m.event_title,
      eventSlug: m.event_slug,
      endDate: m.end_date,
      closed: m.polymarket_closed,
      lastCheckedAt: m.last_checked_at,
      note: m.resolution_note,
      holders: byMarket.get(m.condition_id)?.users.size ?? 0,
      shares: byMarket.get(m.condition_id)?.shares ?? 0,
    }))
    .sort((a, b) => Number(b.closed) - Number(a.closed) || (a.endDate ?? "").localeCompare(b.endDate ?? ""));
}

// Custom markets past their end date that still need the admin's decision.
export async function listEndedCustom(): Promise<{ id: string; title: string; endAt: string; notifySentAt: string | null; holders: number }[]> {
  const db = adminClient();
  const { data } = await db
    .from("custom_markets")
    .select("id, title, end_at, notify_sent_at")
    .eq("status", "open")
    .lte("end_at", new Date().toISOString())
    .order("end_at");
  const ids = (data ?? []).map((m) => `custom:${m.id}`);
  const holders = new Map<string, Set<string>>();
  if (ids.length) {
    const { data: pos } = await db.from("positions").select("condition_id, user_id").in("condition_id", ids).gt("shares", 0);
    for (const p of pos ?? []) holders.set(p.condition_id, (holders.get(p.condition_id) ?? new Set()).add(p.user_id));
  }
  return (data ?? []).map((m) => ({ id: m.id, title: m.title, endAt: m.end_at, notifySentAt: m.notify_sent_at, holders: holders.get(`custom:${m.id}`)?.size ?? 0 }));
}
