"use client";

import { useEffect, useState } from "react";
import { trading } from "@/config/site";
import { cents, shares as fmtShares, usd } from "@/lib/format";
import type { LiveMarket } from "@/lib/polymarket/display";
import type { Market } from "@/lib/polymarket/types";
import type { Quote, QuoteError } from "@/lib/trading/quote";

const QUOTE_ERRORS: Record<QuoteError, string> = {
  no_quote: "No one is offering a price on this side right now, so it can't be traded.",
  price_out_of_range: "This outcome is priced at the extreme (basically decided), so trading is blocked.",
  amount_too_small: "Amount too small to fill.",
  nothing_to_sell: "Enter how many shares to sell.",
};

type Props = {
  market: Market;
  live: LiveMarket | undefined;
  outcomeIndex: 0 | 1;
  onOutcome: (i: 0 | 1) => void;
  blockedReason: string | null;
};

export function TradePanel({ market, live, outcomeIndex, onOutcome, blockedReason }: Props) {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<{ key: string; quote: Quote | null } | null>(null);
  const token = market.outcomes[outcomeIndex]?.tokenId;
  const value = Number(amount);
  // Each quote is tied to the exact request it answers, so stale answers never show.
  const reqKey = token && value > 0 && !blockedReason ? `${token}|${mode}|${value}` : null;
  const quote = result && result.key === reqKey ? result.quote : null;
  const loading = reqKey !== null && result?.key !== reqKey;

  useEffect(() => {
    if (!reqKey) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      let q: Quote | null = null;
      try {
        const res = await fetch(`/api/quote?token=${token}&side=${mode}&amount=${value}`);
        if (res.ok) q = (await res.json()).quote as Quote;
      } catch {}
      if (!cancelled) setResult({ key: reqKey, quote: q });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [reqKey, token, mode, value]);

  const sides = [live?.yes, live?.no];

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-1 truncate text-sm font-semibold">{market.label}</div>
      <div className="mb-3 flex gap-4 border-b border-line text-sm">
        {(["buy", "sell"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`-mb-px border-b-2 pb-2 font-semibold capitalize ${mode === m ? "border-accent text-text" : "border-transparent text-muted"}`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {market.outcomes.slice(0, 2).map((o, i) => {
          const s = sides[i];
          const price = mode === "buy" ? s?.ask : s?.bid;
          const selected = outcomeIndex === i;
          const tone = i === 0 ? "yes" : "no";
          return (
            <button
              key={o.tokenId}
              onClick={() => onOutcome(i as 0 | 1)}
              aria-pressed={selected}
              className={`truncate rounded-xl px-3 py-3 text-sm font-semibold transition-colors ${
                selected
                  ? tone === "yes"
                    ? "bg-yes text-bg"
                    : "bg-no text-bg"
                  : tone === "yes"
                    ? "bg-yes/15 text-yes"
                    : "bg-no/15 text-no"
              }`}
            >
              {o.name} {cents(price ?? null)}
            </button>
          );
        })}
      </div>

      <label className="mt-4 block text-xs text-muted" htmlFor="amount">
        {mode === "buy" ? "Amount (paper $)" : "Shares to sell"}
      </label>
      <div className="mt-1 flex items-center rounded-xl border border-line bg-bg px-3 focus-within:border-accent">
        {mode === "buy" ? <span className="text-muted">$</span> : null}
        <input
          id="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder="0"
          className="tabular w-full bg-transparent px-1 py-3 text-right text-xl font-semibold outline-none"
        />
      </div>
      {mode === "buy" ? (
        <div className="mt-2 flex gap-1.5">
          {[10, 50, 100, 500].map((n) => (
            <button key={n} onClick={() => setAmount(String((Number(amount) || 0) + n))} className="flex-1 rounded-lg bg-surface-2 py-1.5 text-xs font-medium text-muted hover:text-text">
              +${n}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-4 min-h-[92px] space-y-1.5 text-sm">
        {blockedReason ? (
          <p className="text-warn">{blockedReason}</p>
        ) : !(value > 0) ? (
          <p className="text-muted">
            Fills at the real best {mode === "buy" ? "ask" : "bid"}, walking the live order book up to {Math.round(trading.maxSlippage * 100)}¢ away, max{" "}
            {usd(trading.maxTradeUsd, { cents: false })} per trade.
          </p>
        ) : loading ? (
          <p className="text-muted">Getting a price…</p>
        ) : !quote ? (
          <p className="text-warn">Couldn&apos;t get a price right now.</p>
        ) : quote && !quote.ok ? (
          <p className="text-warn">{QUOTE_ERRORS[quote.reason]}</p>
        ) : quote && quote.ok ? (
          <>
            <Row k="Avg price" v={cents(quote.avgPrice)} />
            <Row k="Shares" v={fmtShares(quote.shares)} />
            <Row k={mode === "buy" ? "Cost" : "You receive"} v={usd(quote.total)} />
            {mode === "buy" ? <Row k="Payout if it wins" v={usd(quote.payoutIfWin)} strong /> : null}
            {quote.capped ? (
              <p className="pt-1 text-xs text-warn">
                {quote.capReason === "size"
                  ? `Capped at ${usd(trading.maxTradeUsd, { cents: false })} per trade.`
                  : `Only part fills: the real order book runs out within ${Math.round(trading.maxSlippage * 100)}¢ of the best price.`}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <button disabled className="mt-3 w-full cursor-not-allowed rounded-xl border border-line bg-surface-2 py-3 text-sm font-semibold text-muted">
        Sign-in and trading arrive in the next update
      </button>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{k}</span>
      <span className={`tabular ${strong ? "font-semibold text-yes" : ""}`}>{v}</span>
    </div>
  );
}
