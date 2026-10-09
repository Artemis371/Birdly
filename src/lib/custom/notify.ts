import "server-only";
import { site } from "@/config/site";
import { emailConfigured, escapeHtml, sendAdminEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { adminClient } from "@/lib/supabase/admin";

// Daily cron: email the admin once per custom market whose end date passed
// and that still needs a winner. The row is "claimed" (notify_sent_at set)
// before sending so overlapping runs can't double-send; if the send fails the
// claim is released and tomorrow's run tries again.
export async function notifyEndedCustomMarkets(): Promise<{ sent: number; failed: number; skipped: string | null }> {
  if (!emailConfigured()) return { sent: 0, failed: 0, skipped: "email not configured" };
  const db = adminClient();
  const { data: due } = await db
    .from("custom_markets")
    .select("id, title, end_at")
    .eq("status", "open")
    .lte("end_at", new Date().toISOString())
    .is("notify_sent_at", null)
    .limit(20);

  let sent = 0;
  let failed = 0;
  for (const m of due ?? []) {
    const { data: claimed } = await db
      .from("custom_markets")
      .update({ notify_sent_at: new Date().toISOString() })
      .eq("id", m.id)
      .is("notify_sent_at", null)
      .select("id");
    if (!claimed?.length) continue; // someone else got it

    const link = `${env.siteUrl()}/admin/leahys/${m.id}/resolve`;
    const ended = new Date(m.end_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const r = await sendAdminEmail(
      `${site.name}: pick the winner for "${m.title}"`,
      `<p>The ${escapeHtml(site.name)} market <strong>${escapeHtml(m.title)}</strong> ended on ${ended}. Trading is closed and it's waiting for your final decision.</p>
<p><a href="${link}">Resolve it now</a></p>
<p style="color:#888;font-size:12px">You get one email per market. It also shows under Admin, Waiting to pay out.</p>`,
      `"${m.title}" ended on ${ended} and needs a winner.\nResolve it: ${link}`,
    );
    if (r.ok) {
      sent++;
    } else {
      failed++;
      console.error("[notify]", m.id, r.error);
      await db.from("custom_markets").update({ notify_sent_at: null }).eq("id", m.id);
    }
  }
  return { sent, failed, skipped: null };
}
