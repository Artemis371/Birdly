// Pure validation for the admin create/edit form.

export const DEFAULT_LIQUIDITY = 1000;

export type CustomInput = {
  slug: string;
  title: string;
  description: string;
  rules: string;
  outcomes: string[];
  endAt: string; // ISO
  liquidity: number;
};

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

export function validateCustomInput(raw: Record<string, unknown>, opts: { publishing: boolean; now?: number }): { ok: true; value: CustomInput } | { ok: false; error: string; field: string } {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const title = str(raw.title);
  if (title.length < 3 || title.length > 140) return { ok: false, field: "title", error: "Title must be 3 to 140 characters." };
  const slug = str(raw.slug) ? slugify(str(raw.slug)) : slugify(title);
  if (!slug) return { ok: false, field: "slug", error: "Add a URL name (letters and numbers)." };
  const description = str(raw.description);
  const rules = str(raw.rules);
  if (description.length > 4000) return { ok: false, field: "description", error: "Description is too long." };
  if (rules.length > 4000) return { ok: false, field: "rules", error: "Rules are too long." };
  if (opts.publishing && rules.length < 10) return { ok: false, field: "rules", error: "Write the resolution rules before publishing." };

  const list = Array.isArray(raw.outcomes) ? raw.outcomes : typeof raw.outcomes === "string" ? raw.outcomes.split("\n") : [];
  const outcomes = list.map((o) => str(o)).filter(Boolean);
  if (outcomes.length < 2 || outcomes.length > 12) return { ok: false, field: "outcomes", error: "Use 2 to 12 outcomes, one per line." };
  if (outcomes.some((o) => o.length > 60)) return { ok: false, field: "outcomes", error: "Keep each outcome under 60 characters." };
  if (new Set(outcomes.map((o) => o.toLowerCase())).size !== outcomes.length) return { ok: false, field: "outcomes", error: "Outcomes must all be different." };

  const end = Date.parse(str(raw.endAt));
  if (!Number.isFinite(end)) return { ok: false, field: "endAt", error: "Pick an end date." };
  if (opts.publishing && end <= (opts.now ?? Date.now())) return { ok: false, field: "endAt", error: "The end date has to be in the future to publish." };

  const liquidity = raw.liquidity === undefined || raw.liquidity === "" ? DEFAULT_LIQUIDITY : Number(raw.liquidity);
  if (!Number.isFinite(liquidity) || liquidity < 50 || liquidity > 100000) return { ok: false, field: "liquidity", error: "Liquidity must be between 50 and 100,000." };

  return { ok: true, value: { slug, title, description, rules, outcomes, endAt: new Date(end).toISOString(), liquidity: Math.round(liquidity * 100) / 100 } };
}
