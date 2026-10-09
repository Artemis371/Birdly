"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { trading } from "@/config/site";
import { cents, shares as fmtShares, usd } from "@/lib/format";
import type { LiveMarket } from "@/lib/polymarket/display";
import type { Market } from "@/lib/polymarket/types";
import type { Quote, QuoteError } from "@/lib/trading/quote";
import type { Viewer } from "./EventView";

const QUOTE_ERRORS: Record<QuoteError, string> = {
  no_quote: "No one is offering a price on this side right now, so it can't be traded.",
  price_out_of_range: "This outcome is priced at the extreme (basically decided), so trading is blocked.",
  amount_too_small: "Amount too small to fill.",
  nothing_to_sell: "Enter how many shares to sell.",
};

type OkQuote = Extract<Quote, { ok: true }>;
type Signed = { quote: OkQuote; token: string; expiresAt: number; outcomeName: string; label: string };
type Confirming = { signed: Signed; notice?: string };

type Props = {
  slug: string;
  market: Market;
  live: LiveMarket | undefined;
  outcomeIndex: 0 | 1;
  onOutcome: (i: 0 | 1) => void;
  blockedReason: string | null;
  viewer: Viewer;
};

export function TradePanel({ slug, market, live, outcomeIndex, onOutcome, blockedReason, viewer }: Props) {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<{ key: string; quote: Quote | null } | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const token = market.outcomes[outcomeIndex]?.tokenId;
  const owned = viewer.loggedIn ? (viewer.holdings[token] ?? 0) : 0;
  const raw = Number(amount);
  const value = mode === "sell" && viewer.loggedIn ? Math.min(raw, owned) : raw;

  // Live, read-only preview while typing (cached book). Execution re-prices fresh.
  const reqKey = token && value > 0 && !blockedReason ? `${token}|${mode}|${value}` : null;
  const quote = preview && preview.key === reqKey ? preview.quote : null;
  const loading = reqKey !== null && preview?.key !== reqKey;

  useEffect(() => {
    if (!reqKey) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      let q: Quote | null = null;
      try {
        const res = await fetch(`/api/quote?token=${token}&side=${mode}&amount=${value}`);
        if (res.ok) q = (await res.json()).quote as Quote;
      } catch {}
      if (!cancelled) setPreview({ key: reqKey, quote: q });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [reqKey, token, mode, value]);

  // Logged-out "Log in to trade" returns to this exact market and side.
  const loginHref = `/login?next=${encodeURIComponent(`${pathname}?m=${market.id}${outcomeIndex === 1 ? "&side=no" : ""}`)}`;

  async function requestQuote() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/trade/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, conditionId: market.conditionId, outcomeIndex, side: mode, amount: value }),
      });
      const data = await res.json();
      if (res.status === 401) return router.push(loginHref);
      if (!res.ok) return setMessage({ kind: "err", text: data.error ?? "Couldn't get a price." });
      setConfirming({ signed: data });
    } catch {
      setMessage({ kind: "err", text: "Couldn't reach the server. Check your connection." });
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!confirming) return;
    setBusy(true);
    try {
      const res = await fetch("/api/trade/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: confirming.signed.token }) });
      const data = await res.json();
      if (res.ok) {
        const f = data.filled as OkQuote;
        setConfirming(null);
        setAmount("");
        setMessage({
          kind: "ok",
          text: `${mode === "buy" ? "Bought" : "Sold"} ${fmtShares(f.shares)} ${market.outcomes[outcomeIndex].name} shares at ${cents(f.avgPrice)} for ${usd(f.total)}. Cash: ${usd(data.cash)}.`,
        });
        router.refresh();
      } else if (data.code === "price_moved" && data.quote) {
        setConfirming({ signed: data.quote, notice: data.error });
      } else if (data.code === "quote_expired") {
        setConfirming(null);
        await requestQuote();
      } else {
        setConfirming(null);
        setMessage({ kind: "err", text: data.error ?? "Trade failed." });
      }
    } catch {
      setMessage({ kind: "err", text: "Couldn't reach the server. Your trade may not have gone through; check your portfolio." });
    } finally {
      setBusy(false);
    }
  }

  const sides = [live?.yes, live?.no];
  const outcomeName = market.outcomes[outcomeIndex]?.name ?? "";

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="truncate text-sm font-semibold">{market.label}</div>
        {viewer.loggedIn ? <div className="tabular shrink-0 text-xs text-muted">Cash {usd(viewer.cash)}</div> : null}
      </div>
      <div className="mb-3 flex gap-4 border-b border-line text-sm">
        {(["buy", "sell"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setMessage(null);
            }}
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
                selected ? (tone === "yes" ? "bg-yes text-bg" : "bg-no text-bg") : tone === "yes" ? "bg-yes/15 text-yes" : "bg-no/15 text-no"
              }`}
            >
              {o.name} {cents(price ?? null)}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-end justify-between">
        <label className="block text-xs text-muted" htmlFor="amount">
          {mode === "buy" ? "Amount (paper $)" : "Shares to sell"}
        </label>
        {mode === "sell" && viewer.loggedIn ? (
          <span className="text-xs text-muted">
            You own {fmtShares(owned)}
            {owned > 0 ? (
              <button className="ml-2 font-semibold text-accent" onClick={() => setAmount(String(owned))}>
                Max
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-center rounded-xl border border-line bg-bg px-3 focus-within:border-accent">
        {mode === "buy" ? <span className="text-muted">$</span> : null}
        <input
          id="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value.replace(/[^\d.]/g, ""));
            setMessage(null);
          }}
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
        ) : mode === "sell" && viewer.loggedIn && owned <= 0 ? (
          <p className="text-muted">You don&apos;t own any {outcomeName} shares here.</p>
        ) : !(value > 0) ? (
          <p className="text-muted">
            Fills at the real best {mode === "buy" ? "ask" : "bid"}, walking the live order book up to {Math.round(trading.maxSlippage * 100)}¢ away, max{" "}
            {usd(trading.maxTradeUsd, { cents: false })} per trade.
          </p>
        ) : loading ? (
          <p className="text-muted">Getting a price…</p>
        ) : !quote ? (
          <p className="text-warn">Couldn&apos;t get a price right now.</p>
        ) : !quote.ok ? (
          <p className="text-warn">{QUOTE_ERRORS[quote.reason]}</p>
        ) : (
          <QuoteRows q={quote} mode={mode} />
        )}
        {mode === "buy" && viewer.loggedIn && quote?.ok && quote.total > viewer.cash ? <p className="text-warn">That&apos;s more than your {usd(viewer.cash)} cash.</p> : null}
      </div>

      {message ? (
        <p role="status" className={`mt-2 rounded-lg px-3 py-2 text-sm ${message.kind === "ok" ? "bg-yes/10 text-yes" : "bg-no/10 text-no"}`}>
          {message.text}
        </p>
      ) : null}

      {!viewer.loggedIn ? (
        <Link href={loginHref} className="mt-3 block w-full rounded-xl bg-accent py-3 text-center text-sm font-semibold text-bg">
          Log in to trade
        </Link>
      ) : (
        <button
          onClick={requestQuote}
          disabled={busy || !!blockedReason || !quote?.ok || (mode === "buy" && quote.total > viewer.cash)}
          className={`mt-3 w-full rounded-xl py-3 text-sm font-semibold text-bg disabled:opacity-40 ${outcomeIndex === 0 ? "bg-yes" : "bg-no"}`}
        >
          {busy && !confirming ? "Getting a fresh price…" : `${mode === "buy" ? "Buy" : "Sell"} ${outcomeName}`}
        </button>
      )}

      {confirming ? (
        <ConfirmSheet c={confirming} mode={mode} busy={busy} onCancel={() => setConfirming(null)} onConfirm={execute} />
      ) : null}
    </div>
  );
}

function QuoteRows({ q, mode }: { q: OkQuote; mode: "buy" | "sell" }) {
  return (
    <>
      <Row k="Avg price" v={cents(q.avgPrice)} />
      <Row k="Shares" v={fmtShares(q.shares)} />
      <Row k={mode === "buy" ? "Cost" : "You receive"} v={usd(q.total)} />
      {mode === "buy" ? <Row k="Payout if it wins" v={usd(q.payoutIfWin)} strong /> : null}
      {q.capped ? (
        <p className="pt-1 text-xs text-warn">
          {q.capReason === "size"
            ? `Capped at ${usd(trading.maxTradeUsd, { cents: false })} per trade.`
            : `Only part fills: the real order book runs out within ${Math.round(trading.maxSlippage * 100)}¢ of the best price.`}
        </p>
      ) : null}
    </>
  );
}

function ConfirmSheet({ c, mode, busy, onCancel, onConfirm }: { c: Confirming; mode: "buy" | "sell"; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const q = c.signed.quote;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Confirm trade">
      <div className="w-full max-w-sm rounded-t-2xl border border-line bg-surface p-5 sm:rounded-2xl">
        <h2 className="text-lg font-bold">
          {mode === "buy" ? "Buy" : "Sell"} {c.signed.outcomeName}
        </h2>
        <p className="mb-3 truncate text-sm text-muted">{c.signed.label}</p>
        {c.notice ? <p className="mb-3 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{c.notice}</p> : null}
        <div className="space-y-1.5 text-sm">
          <QuoteRows q={q} mode={mode} />
        </div>
        <p className="mt-3 text-xs text-muted">
          Fresh price from the live order book. If it moves more than {Math.round(trading.quoteTolerance * 100)}¢ before you confirm, we&apos;ll show you the new one first.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={onCancel} disabled={busy} className="rounded-xl border border-line py-3 text-sm font-semibold text-muted">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy} className="rounded-xl bg-accent py-3 text-sm font-semibold text-bg disabled:opacity-60">
            {busy ? "Placing…" : "Confirm"}
          </button>
        </div>
      </div>
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
