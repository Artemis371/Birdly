import "server-only";
import { cache } from "react";
import { env, isConfigured } from "@/lib/env";
import { adminClient } from "@/lib/supabase/admin";
import { sessionClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  isAdmin: boolean;
  cash: number;
};

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && env.adminEmails().includes(email.toLowerCase());
}

// The signed-in, active user for this request, or null. Verifies the JWT
// (getClaims) and checks the profile in the database, so deactivated users
// are treated as signed out even if their token hasn't expired yet.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (!isConfigured()) return null;
  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;

  const db = adminClient();
  const [{ data: profile }, { data: balance }] = await Promise.all([
    db.from("profiles").select("display_name, created_at, deactivated_at").eq("id", claims.sub).maybeSingle(),
    db.from("balances").select("cash, seasons!inner(is_current)").eq("user_id", claims.sub).eq("seasons.is_current", true).maybeSingle(),
  ]);
  if (!profile || profile.deactivated_at) return null;

  const email = typeof claims.email === "string" ? claims.email : "";
  return {
    id: claims.sub,
    email,
    displayName: profile.display_name,
    createdAt: profile.created_at,
    isAdmin: isAdminEmail(email),
    cash: Number(balance?.cash ?? 0),
  };
});
