import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { usd } from "@/lib/format";
import { loadLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leaderboard" };

const MEDALS = ["🥇", "🥈", "🥉"];

export default async function LeaderboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/leaderboard");
  const { rows, stale, startingBalance } = await loadLeaderboard();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Leaderboard</h1>
      <p className="mb-4 text-sm text-muted">
        Cash plus open positions at today&apos;s sell price. Everyone started with {usd(startingBalance, { cents: false })}.
      </p>
      {stale ? <p className="mb-3 rounded-xl bg-warn/10 px-4 py-3 text-sm text-warn">Live prices are delayed, so some values may be slightly out of date.</p> : null}
      <ol className="overflow-hidden rounded-2xl border border-line bg-surface">
        {rows.map((r) => {
          const tone = r.returnPct > 0.00005 ? "text-yes" : r.returnPct < -0.00005 ? "text-no" : "text-muted";
          return (
            <li key={r.userId} className={`flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 ${r.userId === user.id ? "bg-accent/10" : ""}`}>
              <span className="tabular w-8 shrink-0 text-center text-lg font-bold">{MEDALS[r.rank - 1] ?? r.rank}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">
                  {r.displayName}
                  {r.userId === user.id ? <span className="ml-1 text-xs text-accent">(you)</span> : null}
                </div>
                <div className="tabular text-xs text-muted">
                  {usd(r.cash, { cents: false })} cash · {usd(r.positionsValue, { cents: false })} in {r.openPositions} position{r.openPositions === 1 ? "" : "s"}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="tabular font-semibold">{usd(r.total)}</div>
                <div className={`tabular text-xs font-medium ${tone}`}>
                  {r.returnPct > 0 ? "+" : r.returnPct < 0 ? "−" : ""}
                  {Math.abs(r.returnPct * 100).toFixed(1)}%
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
