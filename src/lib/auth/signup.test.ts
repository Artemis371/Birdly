import { describe, expect, it, vi } from "vitest";
import { signup, type SignupDeps } from "./signup";
import { safeNext, validatePassword } from "./validation";

const good = { email: "Dad@Example.com ", password: "birdsong42!", displayName: "Dad", inviteCode: " Robin-Nest-77 " };

function deps(over: Partial<SignupDeps> = {}): SignupDeps & { createUser: ReturnType<typeof vi.fn> } {
  return {
    inviteCode: "robin-nest-77",
    allowAttempt: async () => true,
    displayNameTaken: async () => false,
    createUser: vi.fn(async () => ({ ok: true as const, userId: "u1" })),
    ...over,
  } as SignupDeps & { createUser: ReturnType<typeof vi.fn> };
}

describe("signup", () => {
  it("creates the account with a normalized email and a case/space-insensitive invite code", async () => {
    const d = deps();
    const r = await signup(good, d);
    expect(r).toMatchObject({ ok: true, userId: "u1", email: "dad@example.com" });
    expect(d.createUser).toHaveBeenCalledTimes(1);
    expect(d.createUser).toHaveBeenCalledWith("dad@example.com", "birdsong42!", "Dad");
  });

  it("rejects a bad invite code before touching anything else", async () => {
    const d = deps({ displayNameTaken: vi.fn(async () => false) });
    const r = await signup({ ...good, inviteCode: "guess" }, d);
    expect(r).toMatchObject({ ok: false, status: 403, field: "inviteCode" });
    expect(r.ok ? "" : r.error).toMatch(/invite code isn't right/);
    expect(d.createUser).not.toHaveBeenCalled();
    expect(d.displayNameTaken).not.toHaveBeenCalled();
  });

  it("rejects a missing invite code", async () => {
    expect(await signup({ ...good, inviteCode: undefined }, deps())).toMatchObject({ ok: false, status: 403 });
  });

  it("is rate limited, before checking the invite code", async () => {
    const r = await signup({ ...good, inviteCode: "guess" }, deps({ allowAttempt: async () => false }));
    expect(r).toMatchObject({ ok: false, status: 429 });
  });

  it("reports a duplicate email clearly", async () => {
    const d = deps({ createUser: vi.fn(async () => ({ ok: false as const, code: "email_exists", message: "A user with this email address has already been registered" })) });
    const r = await signup(good, d);
    expect(r).toMatchObject({ ok: false, status: 409, field: "email" });
    expect(r.ok ? "" : r.error).toMatch(/already exists/);
  });

  it("reports a taken display name without creating the user", async () => {
    const d = deps({ displayNameTaken: async () => true });
    const r = await signup(good, d);
    expect(r).toMatchObject({ ok: false, status: 409, field: "displayName" });
    expect(d.createUser).not.toHaveBeenCalled();
  });

  it("maps a display-name race (trigger failure) to 'taken'", async () => {
    let calls = 0;
    const d = deps({
      displayNameTaken: async () => calls++ > 0, // free at first check, taken after
      createUser: vi.fn(async () => ({ ok: false as const, code: "unexpected_failure", message: "Database error creating new user" })),
    });
    expect(await signup(good, d)).toMatchObject({ ok: false, status: 409, field: "displayName" });
  });

  it("rejects weak passwords with a clear message", async () => {
    for (const pw of ["short1", "password123", "aaaaaaaaaa", "onlyletters", "12345678901"]) {
      const r = await signup({ ...good, password: pw }, deps());
      expect(r).toMatchObject({ ok: false, status: 400, field: "password" });
      expect(r.ok ? "" : r.error).toMatch(/too weak/);
    }
  });

  it("rejects bad emails and display names", async () => {
    expect(await signup({ ...good, email: "nope" }, deps())).toMatchObject({ ok: false, field: "email" });
    expect(await signup({ ...good, displayName: "ab" }, deps())).toMatchObject({ ok: false, field: "displayName" });
    expect(await signup({ ...good, displayName: "<script>" }, deps())).toMatchObject({ ok: false, field: "displayName" });
  });
});

describe("validation helpers", () => {
  it("password may not contain the email or display name", () => {
    expect(validatePassword("dadster99", { email: "dadster@example.com" })).toMatch(/email/);
    expect(validatePassword("robin2025!", { displayName: "Robin" })).toMatch(/display name/);
    expect(validatePassword("birdsong42!")).toBeNull();
  });
  it("safeNext only allows same-site paths", () => {
    expect(safeNext("/event/x?m=1")).toBe("/event/x?m=1");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
  });
});
