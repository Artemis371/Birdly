import { describe, expect, it, vi } from "vitest";
import { categorySlug, homeChips } from "./chips";

describe("home chips", () => {
  const custom = [
    { label: "Leahys", slug: "leahys" },
    { label: "Rooneys", slug: "rooneys" },
  ];

  it("logged-out visitors see no custom tabs", () => {
    const chips = homeChips(false, custom);
    expect(chips.some((c) => c.slug === "leahys" || c.slug === "rooneys")).toBe(false);
  });

  it("members see each custom tab right after Trending, Rooneys after Leahys", () => {
    const chips = homeChips(true, custom);
    expect(chips.slice(0, 3).map((c) => c.label)).toEqual(["Trending", "Leahys", "Rooneys"]);
  });
});

describe("categorySlug", () => {
  it("makes a stable slug and rejects clashes or empty names", () => {
    expect(categorySlug("  Rooneys  ")).toEqual({ ok: true, slug: "rooneys", label: "Rooneys" });
    expect(categorySlug("Sports").ok).toBe(false);
    expect(categorySlug("!!!").ok).toBe(false);
    expect(categorySlug("x".repeat(31)).ok).toBe(false);
  });
});

// A market shows only under its own tab: the tab listing filters by category.
type Row = Record<string, unknown>;
const rows: Row[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    from: (table: string) => {
      let r = table === "custom_markets" ? [...rows] : [];
      const q = {
        select: () => q,
        neq: (c: string, v: unknown) => ((r = r.filter((x) => x[c] !== v)), q),
        eq: (c: string, v: unknown) => ((r = r.filter((x) => x[c] === v)), q),
        in: () => q,
        order: () => q,
        limit: () => q,
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: r, error: null }).then(res),
      };
      return q;
    },
  }),
}));

describe("listPublishedCustom", () => {
  it("returns only the markets in the requested tab", async () => {
    const base = { description: "", rules: "", outcomes: ["Yes", "No"], q: [0, 0], liquidity: 1000, end_at: "2099-01-01T00:00:00Z", winning_index: null };
    rows.push(
      { ...base, id: "a", slug: "a", title: "In Leahys", status: "open", category_id: 1 },
      { ...base, id: "b", slug: "b", title: "In Rooneys", status: "open", category_id: 2 },
      { ...base, id: "c", slug: "c", title: "Rooneys draft", status: "draft", category_id: 2 },
    );
    const { listPublishedCustom } = await import("./markets");
    expect((await listPublishedCustom(1)).map((m) => m.title)).toEqual(["In Leahys"]);
    expect((await listPublishedCustom(2)).map((m) => m.title)).toEqual(["In Rooneys"]);
  });
});
