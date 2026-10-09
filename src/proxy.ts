import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Keeps Supabase sessions fresh so people stay signed in on their phones:
// refreshes the access token from the refresh-token cookie when needed.
export async function proxy(request: NextRequest) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // Skip static assets and the public market-data APIs.
  matcher: ["/((?!_next/static|_next/image|brand/|api/event/|api/history|api/quote|api/health/|api/cron/).*)"],
};
