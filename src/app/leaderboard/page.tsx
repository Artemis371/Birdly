import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InfoTooltip } from "@/components/InfoTooltip";
import { getCurrentUser } from "@/lib/auth/session";
import { usd } from "@/lib/format";
import { loadLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leaderboard" };

const MEDALS = ["🥇", "🥈", "🥉"];

export default async function LeaderboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/leaderboard");
  const { rows, stale, asOf, startingBalance } = await loadLeaderboard();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Leaderboard</h1>
      <p className="mb-4 text-sm text-muted">
        Ranked by Portfolio value <InfoTooltip label="What is Portfolio value?" />, which is cash plus open positions at their current sell price. Everyone started with{" "}
        {usd(startingBalance, { cents: false })}.
      </p>
      {stale ? (
        <p className="mb-3 rounded-xl bg-warn/10 px-4 py-3 text-sm text-warn">
          Live prices are delayed, so this shows the last known prices
          {asOf ? ` (from ${new Date(asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})` : ""}.
        </p>
      ) : null}
      <ol className="overflow-hidden rounded-2xl border border-line bg-surface">
        {rows.map((r) => {
          const tone = r.returnPct > 0.00005 ? "text-yes" : r.returnPct < -0.00005 ? "text-no" : "text-muted";
          return (
            <li key={r.userId} className={`flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 ${r.userId === user.id ? "bg-accent/10" : ""}`}>
              <span className="tabular w-8 shrink-0 text-center text-lg font-bold">{MEDALS[r.rank - 1] ?? r.rank}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="truncate font-semibold">
                    {r.displayName}
                    {r.userId === user.id ? <span className="ml-1 text-xs text-accent">(you)</span> : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="tabular font-semibold">{usd(r.total)}</span>{" "}
                    <span className={`tabular text-xs font-medium ${tone}`}>
                      {r.returnPct > 0 ? "+" : r.returnPct < 0 ? "−" : ""}
                      {Math.abs(r.returnPct * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="tabular mt-0.5 text-right text-xs text-muted">
                  Cash {usd(r.cash)} + Positions {usd(r.positionsValue)} ({r.openPositions} open)
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
