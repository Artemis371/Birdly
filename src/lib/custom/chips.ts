import { categories as polymarketCategories } from "@/config/site";
import { slugify } from "./validate";

type Chip = { label: string; slug: string };

// Category chips on the home page. Custom tabs (Leahys, Rooneys, ...) are
// members only and sit right after "Trending", in their admin-set order.
export function homeChips(loggedIn: boolean, custom: { label: string; slug: string }[], poly: readonly Chip[] = polymarketCategories): Chip[] {
  if (!loggedIn) return [...poly];
  return [poly[0], ...custom.map((c) => ({ label: c.label, slug: c.slug })), ...poly.slice(1)];
}

// Slug for a new custom category, or an error. Slugs never change after
// creation (renaming keeps the link), and can't clash with a Polymarket chip.
export function categorySlug(label: string): { ok: true; slug: string; label: string } | { ok: false; error: string } {
  const clean = label.trim().replace(/\s+/g, " ");
  if (clean.length < 1 || clean.length > 30) return { ok: false, error: "Name it in 1 to 30 characters." };
  const slug = slugify(clean).slice(0, 40).replace(/-+$/, "");
  if (!slug) return { ok: false, error: "Use at least one letter or number in the name." };
  if (polymarketCategories.some((c) => c.slug === slug)) return { ok: false, error: "That name clashes with a built-in category. Pick another." };
  return { ok: true, slug, label: clean };
}
