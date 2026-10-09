import { json } from "@/lib/api-response";
import { requireAdmin } from "@/lib/auth/guard";
import { resolveAll } from "@/lib/resolution/server";

export const maxDuration = 60;

// Admin "Check now": run the same resolution step as the daily cron.
export async function POST() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const s = await resolveAll("admin", 45_000);
  return json({ ok: true, checked: s.checked, paid: s.paid, waiting: s.waiting.length, errors: s.errors, timedOut: s.timedOut });
}
