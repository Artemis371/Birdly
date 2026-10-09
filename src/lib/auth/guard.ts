import "server-only";
import { json } from "@/lib/api-response";
import { isConfigured } from "@/lib/env";
import { getCurrentUser, type CurrentUser } from "./session";

// For route handlers: returns the user, or a ready-made error Response.
export async function requireUser(): Promise<CurrentUser | Response> {
  if (!isConfigured()) return json({ error: "Accounts aren't set up on this server yet." }, { status: 503 });
  const user = await getCurrentUser();
  return user ?? json({ error: "Please log in first." }, { status: 401 });
}

// Admin status is decided on the server from ADMIN_EMAILS, never by the client.
export async function requireAdmin(): Promise<CurrentUser | Response> {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return user.isAdmin ? user : json({ error: "Admins only." }, { status: 403 });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (text.length > 10_000) return {};
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
