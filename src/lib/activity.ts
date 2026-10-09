import "server-only";
import { adminClient } from "@/lib/supabase/admin";

export type ActivityItem = {
  id: number;
  displayName: string;
  kind: "buy" | "sell" | "payout";
  outcomeName: string;
  label: string;
  eventTitle: string;
  href: string;
  shares: number;
  price: number;
  amount: number;
  createdAt: string;
};

export const ACTIVITY_PAGE = 40;

// Recent trades by everyone in the group (display names only, never emails).
export async function loadActivity(beforeId?: number): Promise<ActivityItem[]> {
  let q = adminClient()
    .from("trades")
    .select("id, kind, outcome_name, shares, price, amount, created_at, profiles!inner(display_name), markets(label, event_title, event_slug, source)")
    .order("id", { ascending: false })
    .limit(ACTIVITY_PAGE);
  if (beforeId) q = q.lt("id", beforeId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  type R = {
    id: number;
    kind: ActivityItem["kind"];
    outcome_name: string;
    shares: string;
    price: string;
    amount: string;
    created_at: string;
    profiles: { display_name: string };
    markets: { label: string; event_title: string; event_slug: string; source: string } | null;
  };
  return ((data ?? []) as unknown as R[]).map((t) => ({
    id: t.id,
    displayName: t.profiles.display_name,
    kind: t.kind,
    outcomeName: t.outcome_name,
    label: t.markets?.label ?? "",
    eventTitle: t.markets?.event_title ?? "",
    href: t.markets ? (t.markets.source === "custom" ? `/leahys/${t.markets.event_slug}` : `/event/${t.markets.event_slug}`) : "/",
    shares: Number(t.shares),
    price: Number(t.price),
    amount: Number(t.amount),
    createdAt: t.created_at,
  }));
}
