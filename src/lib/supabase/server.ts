import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { env } from "@/lib/env";

// Per-request client bound to the visitor's auth cookies (session refresh,
// sign in, sign out). Cookie writes only succeed in route handlers and the
// proxy; in server components they're ignored (the proxy refreshes instead).
export async function sessionClient() {
  const store = await cookies();
  return createServerClient(env.supabaseUrl(), env.supabasePublishableKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a server component; safe to ignore.
        }
      },
    },
  });
}

// For route handlers that sign in/out: collects the session cookies Supabase
// wants to set and writes them straight onto the response we return, so it
// doesn't matter how Next merges cookies() writes into custom responses.
export async function routeSessionClient() {
  const store = await cookies();
  const pending: { name: string; value: string; options: Parameters<typeof store.set>[2] }[] = [];
  const supabase = createServerClient(env.supabaseUrl(), env.supabasePublishableKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        pending.push(...toSet);
      },
    },
  });
  function apply<T extends NextResponse>(res: T): T {
    for (const { name, value, options } of pending) res.cookies.set(name, value, options);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
  return { supabase, apply };
}
