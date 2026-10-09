import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ValueChart } from "@/components/ValueChart";
import { EventThumb } from "@/components/markets/EventThumb";
import { getCurrentUser } from "@/lib/auth/session";
import { cents, shares, usd } from "@/lib/format";
import { loadPortfolio } from "@/lib/portfolio";
import { resolveForUser } from "@/lib/resolution/server";

// Per-request: depends on the signed-in user.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Portfolio" };

function Signed({ v, pct }: { v: number; pct?: number | null }) {
  const tone = v > 0.004 ? "text-yes" : v < -0.004 ? "text-no" : "text-muted";
  return (
    <span className={`tabular ${tone}`}>
      {v > 0 ? "+" : v < 0 ? "−" : ""}
      {usd(Math.abs(v))}
      {pct != null ? ` (${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct * 100).toFixed(1)}%)` : ""}
    </span>
  );
}

export default async function PortfolioPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/portfolio");
  // Lazy resolution: pay out any of this user's markets that have resolved,
  // so payouts show up even if the daily cron hasn't run yet.
  const resolution = await resolveForUser(user.id);
  const p = await loadPortfolio(user.id);

  return (
    <div className="space-y-4">
      {resolution?.paid.length ? (
        <div role="status" className="rounded-xl border border-yes/40 bg-yes/10 px-4 py-3 text-sm text-yes">
          {resolution.paid.length === 1 ? "A market you held just resolved" : `${resolution.paid.length} markets you held just resolved`} and paid out. See Trade history below.
        </div>
      ) : null}

      {p.pricesStale ? (
        <div role="status" className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          Live prices are delayed, so position values may be out of date.
        </div>
      ) : null}

      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="text-xs text-muted">Account value</div>
        <div className="tabular text-3xl font-bold">{usd(p.total)}</div>
        <div className="text-sm">
          <Signed v={p.pnl} pct={p.pnlPct} /> <span className="text-muted">all time</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="text-xs text-muted">Cash</div>
            <div className="tabular font-semibold">{usd(p.cash)}</div>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="text-xs text-muted">Positions (at best bid)</div>
            <div className="tabular font-semibold">{usd(p.positionsValue)}</div>
          </div>
        </div>
        <div className="mt-4">
          <ValueChart points={p.history} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Open positions</h2>
        {p.positions.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-muted">
            No open positions yet.{" "}
            <Link href="/" className="text-accent">
              Find a market
            </Link>
          </p>
        ) : (
          <ul className="space-y-2">
            {p.positions.map((pos) => (
              <li key={pos.tokenId} className="rounded-2xl border border-line bg-surface p-4">
                <Link href={`/event/${pos.eventSlug}?c=${pos.conditionId}&side=${pos.outcomeIndex === 1 ? "no" : "yes"}`} className="flex items-start gap-3">
                  <EventThumb src={pos.image} alt="" size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{pos.label}</div>
                    <div className="truncate text-xs text-muted">{pos.eventTitle}</div>
                  </div>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${pos.outcomeIndex === 0 ? "bg-yes/15 text-yes" : "bg-no/15 text-no"}`}>
                    {pos.outcomeName}
                  </span>
                </Link>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  <Stat k="Shares" v={shares(pos.shares)} />
                  <Stat k="Avg cost" v={cents(pos.avgCost)} />
                  <Stat k="Bid now" v={pos.bid === null ? "no bid" : cents(pos.bid)} />
                  <div>
                    <div className="text-xs text-muted">Value · P&amp;L</div>
                    <div className="tabular">
                      {usd(pos.value)} · <Signed v={pos.pnl} />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Trade history</h2>
        {p.trades.length === 0 ? (
          <p className="text-sm text-muted">No trades yet.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {p.trades.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span
                  className={`w-12 shrink-0 text-xs font-semibold uppercase ${
                    t.kind === "buy" ? "text-accent" : t.kind === "sell" ? "text-warn" : t.price >= 1 ? "text-yes" : t.price > 0 ? "text-muted" : "text-no"
                  }`}
                >
                  {t.kind === "payout" ? (t.price >= 1 ? "won" : t.price > 0 ? "split" : "lost") : t.kind}
                </span>
                <Link href={`/event/${t.eventSlug}`} className="min-w-0 flex-1">
                  <div className="truncate">
                    {t.outcomeName} · {t.label}
                  </div>
                  <div className="text-xs text-muted">
                    {t.kind === "payout" ? `${shares(t.shares)} sh resolved at ${usd(t.price)} each` : `${shares(t.shares)} sh @ ${cents(t.price)}`} ·{" "}
                    {new Date(t.createdAt).toLocaleString()}
                  </div>
                </Link>
                <span className="tabular shrink-0">{t.kind === "buy" ? "−" : "+"}{usd(t.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{k}</div>
      <div className="tabular">{v}</div>
    </div>
  );
}
