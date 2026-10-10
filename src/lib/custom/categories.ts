import "server-only";
import { fallbackCustomCategory } from "@/config/site";
import { adminClient } from "@/lib/supabase/admin";
import type { CustomCategory } from "./types";

// Custom market tabs in display order. If the table doesn't exist yet
// (migration 0007 not run), behave like before: one Leahys tab holding every
// custom market (id 0 here means "no category filter").
export async function listCategories(): Promise<CustomCategory[]> {
  const { data, error } = await adminClient().from("custom_categories").select("id, slug, label, sort_order").order("sort_order").order("id");
  if (error) {
    console.error("[custom categories]", error.message);
    return [{ id: 0, ...fallbackCustomCategory, sortOrder: 0 }];
  }
  return (data ?? []).map((c) => ({ id: c.id as number, slug: c.slug as string, label: c.label as string, sortOrder: c.sort_order as number }));
}

// The filter to use when listing a category's markets.
export const categoryFilter = (c: CustomCategory): number | null => (c.id === 0 ? null : c.id);
