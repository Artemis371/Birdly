import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setSession = vi.fn();
const getClaims = vi.fn();
const signOut = vi.fn();
const signInWithPassword = vi.fn();

vi.mock("@/lib/env", () => ({ isConfigured: () => true, env: { supabaseSecretKey: () => "test-secret" } }));
vi.mock("@/lib/rate-limit", () => ({ allow: async () => true, clientIp: () => "1.2.3.4", LIMITS: { forgotPerIp: {}, loginPerIp: {}, loginPerEmail: {} } }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { deactivated_at: null } }) }) }) }) }) }));
vi.mock("@/lib/supabase/server", () => ({
  routeSessionClient: async () => ({
    supabase: { auth: { setSession, getClaims, signOut, signInWithPassword } },
    apply: <T extends NextResponse>(r: T) => r,
  }),
}));

const recovery = await import("./recovery/route");
const login = await import("./login/route");
const post = (route: { POST: (r: Request) => Promise<Response> }, body: unknown) =>
  route.POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => vi.clearAllMocks());

describe("login error messages", () => {
  it("says the email box doesn't hold an email (e.g. autofilled display name)", async () => {
    const res = await post(login, { email: "Tom", password: "secret123" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "email", error: expect.stringMatching(/doesn't look like an email/) });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
  it("asks for a missing password separately", async () => {
    expect(await (await post(login, { email: "a@b.co", password: "" })).json()).toMatchObject({ field: "password", error: "Enter your password." });
  });
  it("accepts emails with stray spaces and capitals", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const res = await post(login, { email: "  Tom@Example.COM ", password: "secret123" });
    expect(res.status).toBe(200);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "tom@example.com", password: "secret123" });
  });
});

describe("recovery link fallback", () => {
  it("accepts a real emailed-link session and sets the recovery cookie", async () => {
    setSession.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    getClaims.mockResolvedValue({ data: { claims: { amr: [{ method: "otp", timestamp: 1 }] } } });
    const res = await post(recovery, { accessToken: "a", refreshToken: "r" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/birdly_recovery=/);
  });
  it("refuses a normal password-login session (no password change without the old one)", async () => {
    setSession.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    getClaims.mockResolvedValue({ data: { claims: { amr: [{ method: "password", timestamp: 1 }] } } });
    const res = await post(recovery, { accessToken: "a", refreshToken: "r" });
    expect(res.status).toBe(400);
    expect(signOut).toHaveBeenCalled();
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/birdly_recovery=/);
  });
  it("refuses expired or bogus tokens", async () => {
    setSession.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });
    expect((await post(recovery, { accessToken: "a", refreshToken: "r" })).status).toBe(400);
    expect((await post(recovery, {})).status).toBe(400);
  });
});
