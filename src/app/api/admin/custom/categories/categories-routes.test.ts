import { beforeEach, describe, expect, it, vi } from "vitest";

// Non-admins can't create, rename or reorder tabs, or move markets, and the
// database is never touched for them.
const getCurrentUser = vi.fn();
const rpc = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/env", () => ({ isConfigured: () => true, env: { siteUrl: () => "http://x" } }));
vi.mock("@/lib/supabase/admin", () => {
  const q = { select: () => q, eq: () => q, in: () => q, neq: () => q, order: () => q, limit: () => q, maybeSingle: () => maybeSingle(), then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r) };
  return { adminClient: () => ({ rpc, from: () => q }) };
});

const categoriesRoute = await import("./route");
const marketRoute = await import("../[id]/route");

const member = { id: "11111111-1111-1111-1111-111111111111", email: "m@x.com", displayName: "Member", isAdmin: false, cash: 1, createdAt: "" };
const admin = { ...member, id: "22222222-2222-2222-2222-222222222222", isAdmin: true };
const marketId = "33333333-3333-3333-3333-333333333333";

const postCategories = (body: unknown) => categoriesRoute.POST(new Request("http://x/api/admin/custom/categories", { method: "POST", body: JSON.stringify(body) }));
const postMarket = (body: unknown) =>
  marketRoute.POST(new Request(`http://x/api/admin/custom/${marketId}`, { method: "POST", body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: marketId }) } as never);

beforeEach(() => vi.clearAllMocks());

describe("custom category routes", () => {
  const actions = [
    { action: "create", label: "Fam" },
    { action: "rename", id: 1, label: "Fam" },
    { action: "reorder", ids: [2, 1] },
  ];

  it("refuse logged-out visitors (401) and members (403) without touching the database", async () => {
    for (const [user, status] of [
      [null, 401],
      [member, 403],
    ] as const) {
      getCurrentUser.mockResolvedValue(user);
      for (const a of actions) expect((await postCategories(a)).status).toBe(status);
      expect((await postMarket({ action: "move", categoryId: 2 })).status).toBe(status);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("let admins create a tab (slug from the name) and move a market", async () => {
    getCurrentUser.mockResolvedValue(admin);
    rpc.mockResolvedValue({ data: 3, error: null });
    expect((await postCategories({ action: "create", label: "  The Fam  " })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("admin_create_custom_category", { p_admin_id: admin.id, p_slug: "the-fam", p_label: "The Fam" });

    maybeSingle.mockResolvedValue({ data: { id: marketId, slug: "m", title: "M?", outcomes: ["Yes", "No"], q: [0, 0], liquidity: 1000, end_at: "2099-01-01T00:00:00Z", status: "resolved", category_id: 1 } });
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await postMarket({ action: "move", categoryId: 2 })).status).toBe(200); // even when resolved
    expect(rpc).toHaveBeenLastCalledWith("admin_move_custom_market", { p_admin_id: admin.id, p_market_id: marketId, p_category_id: 2 });
  });

  it("reject tab names that clash with a built-in category", async () => {
    getCurrentUser.mockResolvedValue(admin);
    const r = await postCategories({ action: "create", label: "Sports" });
    expect(r.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
