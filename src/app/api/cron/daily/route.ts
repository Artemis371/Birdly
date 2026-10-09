import { timingSafeEqual } from "node:crypto";
import { isConfigured } from "@/lib/env";
import { resolveAll } from "@/lib/resolution/server";
import { notifyEndedCustomMarkets } from "@/lib/custom/notify";
import { snapshotAll } from "@/lib/snapshots";

// Daily job (vercel.json): resolve + pay out finished Polymarket markets,
// record everyone's account-value snapshot, and email the admin about custom
// markets that ended and need a winner. Vercel Cron calls this with
// "Authorization: Bearer $CRON_SECRET" when the CRON_SECRET env var is set.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if not configured
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isConfigured()) return Response.json({ error: "not configured" }, { status: 503 });
  const resolution = await resolveAll("cron", 200_000);
  let snapshots: Awaited<ReturnType<typeof snapshotAll>> | { error: string };
  try {
    snapshots = await snapshotAll();
  } catch (err) {
    snapshots = { error: String(err).slice(0, 200) };
  }
  let customEmails: Awaited<ReturnType<typeof notifyEndedCustomMarkets>> | { error: string };
  try {
    customEmails = await notifyEndedCustomMarkets();
  } catch (err) {
    customEmails = { error: String(err).slice(0, 200) };
  }
  return Response.json(
    {
      ok: true,
      customEmails,
      resolution: { checked: resolution.checked, paid: resolution.paid.length, waiting: resolution.waiting.length, errors: resolution.errors.length, timedOut: resolution.timedOut },
      snapshots,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
