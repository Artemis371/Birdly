import { beforeEach, describe, expect, it, vi } from "vitest";

// Non-admins must be refused by every admin route, and the database must
// never be touched for them.
const getCurrentUser = vi.fn();
const listUsers = vi.fn(async () => []);
const rpc = vi.fn();
const updateUserById = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/env", () => ({ isConfigured: () => true, env: { siteUrl: () => "http://x" } }));
vi.mock("@/lib/admin", () => ({ listUsers: () => listUsers() }));
vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({ rpc, auth: { admin: { updateUserById, getUserById: vi.fn(), generateLink: vi.fn() } } }),
}));

const listRoute = await import("./users/route");
const actionRoute = await import("./users/[id]/route");

const member = { id: "11111111-1111-1111-1111-111111111111", email: "m@x.com", displayName: "Member", isAdmin: false, cash: 1, createdAt: "" };
const admin = { ...member, id: "22222222-2222-2222-2222-222222222222", isAdmin: true };
const target = "33333333-3333-3333-3333-333333333333";

function post(action: string) {
  const req = new Request("http://x/api/admin/users/" + target, { method: "POST", body: JSON.stringify({ action }) });
  return actionRoute.POST(req as never, { params: Promise.resolve({ id: target }) } as never);
}

beforeEach(() => vi.clearAllMocks());

describe("admin routes", () => {
  it("refuse logged-out visitors with 401", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await listRoute.GET()).status).toBe(401);
    expect((await post("reset")).status).toBe(401);
    expect(listUsers).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuse non-admin members with 403 and touch nothing", async () => {
    getCurrentUser.mockResolvedValue(member);
    expect((await listRoute.GET()).status).toBe(403);
    for (const action of ["reset", "deactivate", "reactivate", "recovery_link"]) {
      expect((await post(action)).status).toBe(403);
    }
    expect(listUsers).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("allow admins", async () => {
    getCurrentUser.mockResolvedValue(admin);
    expect((await listRoute.GET()).status).toBe(200);
    rpc.mockResolvedValue({ data: 10000, error: null });
    expect((await post("reset")).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("admin_reset_balance", { p_admin_id: admin.id, p_user_id: target });
  });

  it("an admin can't deactivate themselves", async () => {
    getCurrentUser.mockResolvedValue(admin);
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ action: "deactivate" }) });
    const res = await actionRoute.POST(req as never, { params: Promise.resolve({ id: admin.id }) } as never);
    expect(res.status).toBe(400);
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
