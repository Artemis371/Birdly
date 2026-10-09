"use client";

import { useState } from "react";
import type { CustomMarket } from "@/lib/custom/types";
import { pct, shares as fmtShares, usd } from "@/lib/format";

export type OutcomeExposure = { holders: number; shares: number };

export function ResolveCustom({ market, exposure }: { market: CustomMarket; exposure: OutcomeExposure[] }) {
  const [winner, setWinner] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const done = market.status === "resolved" || result?.kind === "ok";

  async function resolve() {
    if (winner === null) return;
    const w = market.outcomes[winner];
    if (!window.confirm(`Resolve "${market.title}" to "${w}"?\n\nWinning shares pay $1 each. This can't be undone.`)) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/custom/${market.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", winner, confirmTitle: market.title }),
      });
      const d = await res.json();
      if (!res.ok) return setResult({ kind: "err", text: d.error ?? "Couldn't resolve." });
      setResult({
        kind: "ok",
        text: d.alreadyResolved ? "This market was already resolved; nothing more was paid." : `Resolved to "${w}". Paid ${usd(d.totalPaid)} across ${d.paidPositions} position${d.paidPositions === 1 ? "" : "s"}.`,
      });
    } catch {
      setResult({ kind: "err", text: "Couldn't reach the server. Reload to check whether it went through." });
    } finally {
      setBusy(false);
    }
  }

  if (market.status === "resolved" && !result) {
    return <p className="rounded-xl bg-yes/10 px-4 py-3 text-sm text-yes">Already resolved to &ldquo;{market.outcomes[market.winningIndex ?? 0]}&rdquo;.</p>;
  }

  return (
    <div className="space-y-4">
      {!market.ended && market.status === "open" ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
          This market is still open (ends {new Date(market.endAt).toLocaleDateString()}). Resolving now closes it early, which is right for &ldquo;when will X happen&rdquo;
          markets once X has happened.
        </p>
      ) : null}
      <fieldset disabled={done || busy} className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Which outcome won?</legend>
        {market.outcomes.map((o, i) => (
          <label key={i} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${winner === i ? "border-accent bg-accent/10" : "border-line bg-surface"}`}>
            <input type="radio" name="winner" checked={winner === i} onChange={() => setWinner(i)} className="accent-[var(--accent)]" />
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{o}</span>
              <span className="block text-xs text-muted">
                Market says {pct(market.prices[i])} · {exposure[i]?.holders ?? 0} holder{exposure[i]?.holders === 1 ? "" : "s"} · would pay {usd(Math.floor((exposure[i]?.shares ?? 0) * 100) / 100)} (
                {fmtShares(exposure[i]?.shares ?? 0)} shares)
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {result ? <p className={`rounded-lg px-3 py-2 text-sm ${result.kind === "ok" ? "bg-yes/10 text-yes" : "bg-no/10 text-no"}`}>{result.text}</p> : null}
      {!done ? (
        <button onClick={resolve} disabled={winner === null || busy} className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-bg disabled:opacity-40">
          {busy ? "Paying out…" : winner === null ? "Pick the winning outcome" : `Resolve to "${market.outcomes[winner]}" and pay out`}
        </button>
      ) : null}
    </div>
  );
}
