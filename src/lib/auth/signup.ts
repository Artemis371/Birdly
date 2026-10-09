import { inviteCodeMatches } from "./invite";
import { normalizeEmail, validateDisplayName, validatePassword } from "./validation";

// Signup logic with its side effects injected, so it can be tested without a
// real Supabase project. The route handler wires in the real dependencies.

export type SignupInput = { email?: unknown; password?: unknown; displayName?: unknown; inviteCode?: unknown };

export type SignupDeps = {
  inviteCode: string;
  allowAttempt: () => Promise<boolean>; // rate limit (per IP)
  displayNameTaken: (name: string) => Promise<boolean>;
  // Creates the auth user with email already confirmed. The database trigger
  // creates the profile + starting balance in the same transaction.
  createUser: (email: string, password: string, displayName: string) => Promise<{ ok: true; userId: string } | { ok: false; code: string; message: string }>;
};

export type SignupResult =
  | { ok: true; userId: string; email: string; password: string }
  | { ok: false; status: number; field?: "email" | "password" | "displayName" | "inviteCode"; error: string };

export async function signup(input: SignupInput, deps: SignupDeps): Promise<SignupResult> {
  if (!(await deps.allowAttempt())) {
    return { ok: false, status: 429, error: "Too many signup attempts. Take a breather and try again in 15 minutes." };
  }
  if (!inviteCodeMatches(input.inviteCode, deps.inviteCode)) {
    return { ok: false, status: 403, field: "inviteCode", error: "That invite code isn't right. Double-check it with whoever invited you." };
  }
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, status: 400, field: "email", error: "Enter a valid email address." };
  const name = validateDisplayName(input.displayName);
  if (!name.ok) return { ok: false, status: 400, field: "displayName", error: name.error };
  const pwError = validatePassword(input.password, { email, displayName: name.value });
  if (pwError) return { ok: false, status: 400, field: "password", error: pwError };
  const password = input.password as string;

  const nameTaken = { ok: false as const, status: 409, field: "displayName" as const, error: "That display name is taken. Try another one." };
  if (await deps.displayNameTaken(name.value)) return nameTaken;

  const created = await deps.createUser(email, password, name.value);
  if (created.ok) return { ok: true, userId: created.userId, email, password };

  if (created.code === "email_exists" || /already (been )?registered|already exists/i.test(created.message)) {
    return { ok: false, status: 409, field: "email", error: "An account with that email already exists. Try logging in instead." };
  }
  if (created.code === "weak_password") {
    return { ok: false, status: 400, field: "password", error: "Password is too weak. Try a longer one." };
  }
  // Supabase reports any trigger failure as a generic database error. The
  // likeliest cause is someone grabbing the same display name a moment ago.
  if (await deps.displayNameTaken(name.value)) return nameTaken;
  return { ok: false, status: 500, error: "Couldn't create your account. Please try again in a minute." };
}
