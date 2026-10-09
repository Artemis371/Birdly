import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { validateCustomInput } from "./validate";

const DB_ERRORS: Record<string, string> = {
  locked_after_trades: "This market has trades, so only the description and end date can change.",
  already_resolved: "This market is already resolved and can't be edited.",
  not_found: "That market wasn't found.",
  not_a_draft: "Only drafts can be deleted.",
  invalid_winner: "Pick one of the outcomes.",
  not_published: "Publish the market before resolving it.",
  custom_markets_slug_key: "Another market already uses that URL name.",
};

export function friendly(message: string): string {
  const k = Object.keys(DB_ERRORS).find((key) => message.includes(key));
  return k ? DB_ERRORS[k] : "Couldn't save that. Check the fields and try again.";
}

export async function saveCustomMarket(adminId: string, id: string | null, body: Record<string, unknown>, publish: boolean) {
  const v = validateCustomInput(body, { publishing: publish });
  if (!v.ok) return { ok: false as const, error: v.error, field: v.field };
  const { data, error } = await adminClient().rpc("admin_save_custom_market", {
    p_admin_id: adminId,
    p_id: id,
    p_slug: v.value.slug,
    p_title: v.value.title,
    p_description: v.value.description,
    p_rules: v.value.rules,
    p_outcomes: v.value.outcomes,
    p_end_at: v.value.endAt,
    p_liquidity: v.value.liquidity,
    p_publish: publish,
  });
  if (error) return { ok: false as const, error: friendly(error.message) };
  return { ok: true as const, id: data as string };
}
