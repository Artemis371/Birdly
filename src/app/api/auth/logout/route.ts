import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/env";
import { routeSessionClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  if (!isConfigured()) return res;
  const { supabase, apply } = await routeSessionClient();
  await supabase.auth.signOut();
  return apply(res);
}
