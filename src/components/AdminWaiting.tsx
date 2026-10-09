"use client";

import Link from "next/link";
import { useState } from "react";
import type { WaitingMarket } from "@/lib/admin";
import { shares, usd } from "@/lib/format";
import { customMarketTimeZone } from "@/config/site";
import { formatInZone } from "@/lib/tz";

function ago(iso: string | null): string {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

export type WaitingCustom = { id: string; title: string; endAt: string; notifySentAt: string | null; holders: number };

export function AdminWaiting({ markets, custom, emailOn }: { markets: WaitingMarket[]; custom: WaitingCustom[]; emailOn: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function checkNow() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/resolve", { method: "POST" });
      const d = await res.json();
      if (!res.ok) return setResult(d.error ?? "Check failed.");
      const paid = (d.paid as { totalPaid: number }[]) ?? [];
      const total = paid.reduce((s, p) => s + p.totalPaid, 0);
      setResult(
        `Checked ${d.checked} market${d.checked === 1 ? "" : "s"}. Paid out ${paid.length}${paid.length ? ` (${usd(total)} total)` : ""}. ${d.waiting} still waiting.` +
          (d.errors?.length ? ` ${d.errors.length} error(s), see Vercel logs.` : "") +
          (d.timedOut ? " Ran out of time; run it again." : ""),
      );
      if (paid.length) setTimeout(() => window.location.reload(), 1500);
    } catch {
      setResult("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Waiting to pay out</h2>
          <p className="text-xs text-muted">Ended Leahys markets that need a winner, and closed Polymarket markets someone still holds (checked daily and when holders open their portfolio).</p>
        </div>
        <button onClick={checkNow} disabled={busy} className="shrink-0 rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium hover:bg-line disabled:opacity-50">
          {busy ? "Checking…" : "Check now"}
        </button>
      </div>
      {result ? <p className="mb-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">{result}</p> : null}
      {custom.length ? (
        <ul className="mb-2 space-y-2">
          {custom.map((m) => (
            <li key={m.id} className="rounded-2xl border border-warn/40 bg-surface p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{m.title}</div>
                  <div className="text-xs text-muted">Leahys market · {m.holders} holder{m.holders === 1 ? "" : "s"}</div>
                </div>
                <Link href={`/admin/leahys/${m.id}/resolve`} className="shrink-0 rounded-lg bg-warn/20 px-3 py-1.5 text-xs font-semibold text-warn">
                  Pick winner
                </Link>
              </div>
              <p className="mt-2">Ended {formatInZone(m.endAt, customMarketTimeZone.zone)}. Trading is closed and it&apos;s waiting for you to pick the winner.</p>
              <p className="mt-1 text-xs text-muted">
                {m.notifySentAt
                  ? `Reminder email sent ${formatInZone(m.notifySentAt, customMarketTimeZone.zone, { time: false })}.`
                  : emailOn
                    ? "Reminder email goes out with the next daily run."
                    : "Reminder emails are off (RESEND_API_KEY / ADMIN_NOTIFY_EMAIL not set)."}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {markets.length === 0 && custom.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">Nothing stuck. Every closed market people held has been paid out.</p>
      ) : markets.length === 0 ? null : (
        <ul className="space-y-2">
          {markets.map((m) => (
            <li key={m.conditionId} className="rounded-2xl border border-line bg-surface p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/event/${m.eventSlug}`} className="min-w-0">
                  <div className="truncate font-semibold">{m.label}</div>
                  <div className="truncate text-xs text-muted">{m.eventTitle}</div>
                </Link>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${m.closed ? "bg-warn/15 text-warn" : "bg-surface-2 text-muted"}`}>
                  {m.closed ? "closed" : "past end date"}
                </span>
              </div>
              <p className="mt-2">{m.note ?? "Not checked yet."}</p>
              <p className="mt-1 text-xs text-muted">
                {m.holders} holder{m.holders === 1 ? "" : "s"} · {shares(m.shares)} shares · last checked {ago(m.lastCheckedAt)}
                {m.endDate ? ` · ended ${new Date(m.endDate).toLocaleDateString()}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
