import "server-only";

// Server-only configuration. Nothing here is exposed to the browser.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See README "Environment variables".`);
  return v;
}

export const env = {
  supabaseUrl: () => required("SUPABASE_URL"),
  supabasePublishableKey: () => required("SUPABASE_PUBLISHABLE_KEY"),
  supabaseSecretKey: () => required("SUPABASE_SECRET_KEY"),
  inviteCode: () => required("INVITE_CODE"),
  // Comma-separated; compared case-insensitively.
  adminEmails: () =>
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  // Public base URL for links Birdly generates (admin reset links). Set
  // SITE_URL for Production only; previews then use their own branch URL.
  siteUrl: () => {
    if (process.env.SITE_URL && process.env.VERCEL_ENV !== "preview") return process.env.SITE_URL.replace(/\/$/, "");
    const host =
      process.env.VERCEL_ENV === "preview"
        ? (process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL)
        : process.env.VERCEL_PROJECT_PRODUCTION_URL;
    return host ? `https://${host}` : (process.env.SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000");
  },
};

export function isConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_SECRET_KEY);
}
