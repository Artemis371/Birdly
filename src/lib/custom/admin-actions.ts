import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { validateCustomInput } from "./validate";

const DB_ERRORS: Record<string, string> = {
  locked_after_trades: "This market has trades, so only the description and end date can change.",
  already_resolved: "This market is already resolved.",
  not_found: "That market wasn't found.",
  not_a_draft: "Only drafts can be deleted.",
  invalid_winner: "Pick one of the outcomes.",
  not_published: "Publish the market before resolving it.",
  custom_markets_slug_key: "Another market already uses that URL name.",
  market_cancelled: "This market was cancelled, so it can't be resolved.",
  market_closed: "This market is closed (resolved or cancelled) and can't be changed.",
  duplicate_outcome: "That outcome already exists.",
  too_many_outcomes: "A market can have at most 12 outcomes.",
  invalid_start_price: "Starting chance must be between 1% and 50%.",
  invalid_outcome_name: "Give the new outcome a name (up to 60 characters).",
  custom_categories_slug_key: "A category with that name already exists.",
  category_not_found: "That category wasn't found.",
  invalid_order: "The category list changed. Reload and try again.",
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
  // New markets can be created straight into a category (default: the first one).
  const categoryId = Number(body.categoryId);
  if (id === null && Number.isInteger(categoryId) && categoryId > 0) {
    const moved = await moveCustomMarket(adminId, data as string, categoryId);
    if (!moved.ok) return { ok: false as const, error: `Saved, but couldn't set the category: ${moved.error}` };
  }
  return { ok: true as const, id: data as string };
}

// Move a market to another category. Only the category changes.
export async function moveCustomMarket(adminId: string, marketId: string, categoryId: number) {
  const { error } = await adminClient().rpc("admin_move_custom_market", { p_admin_id: adminId, p_market_id: marketId, p_category_id: categoryId });
  return error ? { ok: false as const, error: friendly(error.message) } : { ok: true as const };
}
