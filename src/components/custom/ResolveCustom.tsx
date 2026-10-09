"use client";

import { useState } from "react";
import type { CustomMarket } from "@/lib/custom/types";
import type { RefundLine } from "@/lib/custom/exposure";
import { pct, shares as fmtShares, usd } from "@/lib/format";
import { customMarketTimeZone } from "@/config/site";
import { formatInZone } from "@/lib/tz";

export type OutcomeExposure = { holders: number; shares: number };

export function ResolveCustom({ market, exposure, refunds }: { market: CustomMarket; exposure: OutcomeExposure[]; refunds: RefundLine[] }) {
  const [winner, setWinner] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [cancelStep, setCancelStep] = useState(false);
  const done = market.status === "resolved" || market.status === "cancelled" || result?.kind === "ok";
  const refundTotal = refunds.reduce((s, r) => s + r.refund, 0);

  async function cancelMarket() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/custom/${market.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", confirmTitle: market.title }),
      });
      const d = await res.json();
      if (!res.ok) return setResult({ kind: "err", text: d.error ?? "Couldn't cancel." });
      setCancelStep(false);
      setResult({
        kind: "ok",
        text: d.alreadyCancelled
          ? "This market was already cancelled; nothing more was refunded."
          : `Cancelled. Refunded ${usd(d.totalRefunded)} to ${d.refundedUsers} ${d.refundedUsers === 1 ? "person" : "people"}.`,
      });
    } catch {
      setResult({ kind: "err", text: "Couldn't reach the server. Reload to check whether it went through." });
    } finally {
      setBusy(false);
    }
  }

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
  if (market.status === "cancelled" && !result) {
    return <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm">This market was cancelled and everyone was refunded.</p>;
  }

  return (
    <div className="space-y-4">
      {!market.ended && market.status === "open" ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
          This market is still open (ends {formatInZone(market.endAt, customMarketTimeZone.zone)}). Resolving now closes it early, which is right for &ldquo;when will X happen&rdquo;
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
          {busy && !cancelStep ? "Paying out…" : winner === null ? "Pick the winning outcome" : `Resolve to "${market.outcomes[winner]}" and pay out`}
        </button>
      ) : null}

      {!done ? (
        <section className="mt-8 rounded-2xl border border-no/30 bg-surface p-4 text-sm">
          <h2 className="font-semibold">Or cancel the market</h2>
          <p className="mt-1 text-muted">
            No winner. Everyone gets back what they paid in, minus anything they already got back from selling. Trading stops for good and the market can&apos;t be
            resolved afterwards.
          </p>
          {!cancelStep ? (
            <button onClick={() => setCancelStep(true)} disabled={busy} className="mt-3 rounded-lg bg-no/15 px-4 py-2 font-semibold text-no disabled:opacity-50">
              Cancel market and refund…
            </button>
          ) : (
            <div className="mt-3 space-y-3">
              {refunds.length === 0 ? (
                <p>Nobody has traded this market, so there&apos;s nothing to refund.</p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {refunds.map((r) => (
                    <li key={r.displayName} className="flex justify-between px-3 py-2">
                      <span>{r.displayName}</span>
                      <span className="tabular">{r.refund > 0 ? usd(r.refund) : "$0 (already got it back by selling)"}</span>
                    </li>
                  ))}
                  <li className="flex justify-between px-3 py-2 font-semibold">
                    <span>Total refunded</span>
                    <span className="tabular">{usd(refundTotal)}</span>
                  </li>
                </ul>
              )}
              <div className="flex gap-2">
                <button onClick={() => setCancelStep(false)} disabled={busy} className="flex-1 rounded-xl border border-line py-3 font-semibold text-muted">
                  Keep it
                </button>
                <button onClick={cancelMarket} disabled={busy} className="flex-1 rounded-xl bg-no py-3 font-semibold text-bg disabled:opacity-50">
                  {busy ? "Refunding…" : "Yes, cancel and refund"}
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
