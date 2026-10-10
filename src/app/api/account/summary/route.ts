import { NextResponse } from "next/server";
import { getAccountSummary } from "@/lib/account-value";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// The top bar's Portfolio and Cash, refetched on page changes. Prices come
// from the shared 30s cache, so this never hits Polymarket per request.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    return NextResponse.json(await getAccountSummary(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[account summary]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't load your account value." }, { status: 503 });
  }
}
