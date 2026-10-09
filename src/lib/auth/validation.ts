// Pure input validation shared by signup, account and admin routes.

export const DISPLAY_NAME_RE = /^[A-Za-z0-9_.-]([A-Za-z0-9_. -]*[A-Za-z0-9_.-])?$/;

export function validateDisplayName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < 3 || value.length > 20) return { ok: false, error: "Display name must be 3 to 20 characters." };
  if (!DISPLAY_NAME_RE.test(value))
    return { ok: false, error: "Display name can use letters, numbers, spaces, dots, dashes and underscores." };
  return { ok: true, value };
}

export function normalizeEmail(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

const COMMON = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123",
  "qwertyuiop", "11111111", "iloveyou", "abc12345", "letmein1", "welcome1", "birdly123", "football",
]);

export function validatePassword(raw: unknown, context: { email?: string; displayName?: string } = {}): string | null {
  const pw = typeof raw === "string" ? raw : "";
  if (pw.length < 8) return "Password is too weak: use at least 8 characters.";
  if (pw.length > 72) return "Password is too long (72 characters max).";
  if (COMMON.has(pw.toLowerCase())) return "Password is too weak: that one is on every hacker's list.";
  if (/^(.)\1+$/.test(pw)) return "Password is too weak: don't repeat one character.";
  if (!/[A-Za-z]/.test(pw) || !/[^A-Za-z]/.test(pw)) return "Password is too weak: mix letters with numbers or symbols.";
  const lower = pw.toLowerCase();
  if (context.email && lower.includes(context.email.split("@")[0].toLowerCase()) && context.email.split("@")[0].length >= 4)
    return "Password is too weak: don't include your email.";
  if (context.displayName && context.displayName.length >= 4 && lower.includes(context.displayName.toLowerCase()))
    return "Password is too weak: don't include your display name.";
  return null;
}

// Only allow same-site relative redirects (blocks //evil.com and https://...).
export function safeNext(raw: unknown, fallback = "/"): string {
  const v = typeof raw === "string" ? raw : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : fallback;
}
