"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { customMarketTimeZone, refresh, trading } from "@/config/site";
import { formatInZone } from "@/lib/tz";
import { ConfirmSheet, QUOTE_ERRORS, QuoteRows, type Confirming, type OkQuote } from "@/components/markets/TradePanel";
import { PriceChart } from "@/components/markets/PriceChart";
import { type CustomMarket, customTokenId } from "@/lib/custom/types";
import { cents, compactUsd, pct, shares as fmtShares, usd } from "@/lib/format";
import type { Holder } from "@/lib/holders";
import type { Quote } from "@/lib/trading/quote";

type Viewer = { cash: number; holdings: Record<string, number>; isAdmin: boolean };

export function CustomMarketView({ market, viewer, holders }: { market: CustomMarket; viewer: Viewer; holders: Holder[] }) {
  const [prices, setPrices] = useState(market.prices);
  const [selected, setSelected] = useState(() => market.prices.indexOf(Math.max(...market.prices)));
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (market.status !== "open") return;
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/custom/${market.slug}/live`);
        if (!res.ok) throw new Error();
        setPrices((await res.json()).prices);
        setStale(false);
      } catch {
        setStale(true);
      }
    }, refresh.livePricesMs);
    return () => clearInterval(id);
  }, [market.slug, market.status]);

  const resolved = market.status === "resolved";
  const cancelled = market.status === "cancelled";
  const tz = customMarketTimeZone.zone;
  const blocked = market.status === "draft"
    ? "This is a draft. Publish it from the admin page to open trading."
    : cancelled
      ? "This market was cancelled and everyone was refunded."
      : resolved
      ? `Resolved: ${market.outcomes[market.winningIndex ?? 0]}.`
      : market.ended
        ? "Trading closed at the end date. Waiting for the admin to pick the winner."
        : stale
          ? "Can't reach the server right now, so trading is paused."
          : null;
  const order = market.outcomes.map((name, i) => ({ name, i })).sort((a, b) => (resolved ? Number(b.i === market.winningIndex) - Number(a.i === market.winningIndex) : prices[b.i] - prices[a.i]));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-4">
        {cancelled ? (
          <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
            This market was <strong>cancelled</strong>. Everyone got back what they paid in, minus anything they&apos;d already got back from selling.
          </div>
        ) : resolved ? (
          <div className="rounded-xl border border-yes/40 bg-yes/10 px-4 py-3 text-sm text-yes">
            Resolved to <strong>{market.outcomes[market.winningIndex ?? 0]}</strong>. Winning shares paid $1 each.
          </div>
        ) : market.ended ? (
          <div className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
            Trading closed {formatInZone(market.endAt, tz)}. Waiting for the admin to pick the winner.
            {viewer.isAdmin ? (
              <Link href={`/admin/leahys/${market.id}/resolve`} className="ml-2 font-semibold underline">
                Resolve now
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-2xl border border-line bg-surface p-4">
          <PriceChart
            key={selected}
            tokenId={customTokenId(market.id, selected)}
            label={market.outcomes[selected]}
            liveProb={resolved || cancelled ? null : prices[selected]}
            historyBase={`/api/custom/${market.slug}/history?i=${selected}`}
          />
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-muted">
            <span>Outcome</span>
            <span>Chance</span>
          </div>
          <ul className="divide-y divide-line">
            {order.map(({ name, i }) => (
              <li key={i} className={`flex items-center gap-3 px-4 py-3 ${i === selected ? "bg-surface-2" : ""}`}>
                <button onClick={() => setSelected(i)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-medium">
                    {name}
                    {resolved && i === market.winningIndex ? <span className="ml-2 text-xs text-yes">winner</span> : null}
                  </div>
                  {viewer.holdings[customTokenId(market.id, i)] ? (
                    <div className="text-xs text-accent">You hold {fmtShares(viewer.holdings[customTokenId(market.id, i)])} shares</div>
                  ) : null}
                </button>
                <span className="tabular w-14 text-right text-lg font-bold">{cancelled ? "--" : resolved ? (i === market.winningIndex ? "100%" : "0%") : pct(prices[i])}</span>
                {!blocked ? (
                  <button
                    onClick={() => {
                      setSelected(i);
                      if (window.innerWidth < 1024) document.getElementById("trade")?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="shrink-0 rounded-lg bg-yes/15 px-3 py-2 text-xs font-semibold text-yes hover:bg-yes/25"
                  >
                    Buy {cents(prices[i])}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold">Who in the group holds this</h2>
          {holders.length === 0 ? (
            <p className="text-sm text-muted">Nobody yet. Be the first.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {holders.map((h) => (
                <li key={h.displayName + h.tokenId} className="flex items-center gap-2">
                  <span className={`min-w-0 flex-1 truncate ${h.isYou ? "font-semibold text-accent" : ""}`}>
                    {h.displayName}
                    {h.isYou ? " (you)" : ""}
                  </span>
                  <span className="tabular text-muted">{fmtShares(h.shares)} sh</span>
                  <span className="max-w-[45%] truncate rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold">{h.outcomeName}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 text-sm">
          {market.description ? <p className="whitespace-pre-line">{market.description}</p> : null}
          <div>
            <h2 className="mb-1 font-semibold">Rules</h2>
            <p className="whitespace-pre-line text-muted">{market.rules || "No rules written yet."}</p>
          </div>
          <p className="text-xs text-muted">
            {market.ended || resolved || cancelled ? "Ended" : "Ends"} {formatInZone(market.endAt, tz)} ({customMarketTimeZone.label}) · {compactUsd(market.volume)} traded · Priced by an automated market maker (liquidity {market.liquidity.toLocaleString()})
          </p>
        </section>
      </div>

      <aside id="trade" className="lg:sticky lg:top-20 lg:self-start">
        <CustomTradePanel market={market} prices={prices} index={selected} onIndex={setSelected} blocked={blocked} viewer={viewer} />
      </aside>
    </div>
  );
}

function CustomTradePanel({
  market,
  prices,
  index,
  onIndex,
  blocked,
  viewer,
}: {
  market: CustomMarket;
  prices: number[];
  index: number;
  onIndex: (i: number) => void;
  blocked: string | null;
  viewer: Viewer;
}) {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<{ key: string; quote: Quote | null } | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();

  const token = customTokenId(market.id, index);
  const owned = viewer.holdings[token] ?? 0;
  const raw = Number(amount);
  const value = mode === "sell" ? Math.min(raw, owned) : raw;
  const reqKey = value > 0 && !blocked ? `${index}|${mode}|${value}` : null;
  const quote = preview && preview.key === reqKey ? preview.quote : null;
  const loading = reqKey !== null && preview?.key !== reqKey;

  useEffect(() => {
    if (!reqKey) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      let q: Quote | null = null;
      try {
        const res = await fetch(`/api/custom/${market.slug}/live?i=${index}&side=${mode}&amount=${value}`);
        if (res.ok) q = (await res.json()).quote as Quote | null;
      } catch {}
      if (!cancelled) setPreview({ key: reqKey, quote: q });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [reqKey, market.slug, index, mode, value]);

  async function requestQuote() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/custom/trade/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: market.slug, outcomeIndex: index, side: mode, amount: value }),
      });
      const data = await res.json();
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
      const res = await fetch("/api/custom/trade/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: confirming.signed.token }) });
      const data = await res.json();
      if (res.ok) {
        const f = data.filled as OkQuote;
        setConfirming(null);
        setAmount("");
        setMessage({ kind: "ok", text: `${mode === "buy" ? "Bought" : "Sold"} ${fmtShares(f.shares)} "${market.outcomes[index]}" shares at ${cents(f.avgPrice)} for ${usd(f.total)}. Cash: ${usd(data.cash)}.` });
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

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="truncate text-sm font-semibold">{market.title}</div>
        <div className="tabular shrink-0 text-xs text-muted">Cash {usd(viewer.cash)}</div>
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

      <label htmlFor="outcome" className="block text-xs text-muted">
        Outcome
      </label>
      <select
        id="outcome"
        value={index}
        onChange={(e) => onIndex(Number(e.target.value))}
        className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-[16px] outline-none focus:border-accent sm:text-sm"
      >
        {market.outcomes.map((o, i) => (
          <option key={i} value={i}>
            {o} ({cents(prices[i])})
          </option>
        ))}
      </select>

      <div className="mt-4 flex items-end justify-between">
        <label className="block text-xs text-muted" htmlFor="amount">
          {mode === "buy" ? `Amount (paper $, max ${usd(trading.maxTradeUsd, { cents: false })})` : "Shares to sell"}
        </label>
        {mode === "sell" ? (
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
            const v = e.target.value.replace(/[^\d.]/g, "");
            // Buys can't exceed the per-trade maximum.
            setAmount(mode === "buy" && Number(v) > trading.maxTradeUsd ? String(trading.maxTradeUsd) : v);
            setMessage(null);
          }}
          placeholder="0"
          className="tabular w-full bg-transparent px-1 py-3 text-right text-xl font-semibold outline-none"
        />
      </div>
      {mode === "buy" ? (
        <div className="mt-2 flex gap-1.5">
          {[10, 50, 100, 500].map((n) => (
            <button key={n} onClick={() => setAmount(String(Math.min(trading.maxTradeUsd, (Number(amount) || 0) + n)))} className="flex-1 rounded-lg bg-surface-2 py-1.5 text-xs font-medium text-muted hover:text-text">
              +${n}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-4 min-h-[110px] space-y-1.5 text-sm">
        {blocked ? (
          <p className="text-warn">{blocked}</p>
        ) : mode === "sell" && owned <= 0 ? (
          <p className="text-muted">You don&apos;t own any &ldquo;{market.outcomes[index]}&rdquo; shares.</p>
        ) : !(value > 0) ? (
          <p className="text-muted">
            Instant fill from the market maker. Each share pays $1 if this outcome wins. Max {usd(trading.maxTradeUsd, { cents: false })} per trade.
          </p>
        ) : loading ? (
          <p className="text-muted">Getting a price…</p>
        ) : !quote ? (
          <p className="text-warn">Couldn&apos;t get a price right now.</p>
        ) : !quote.ok ? (
          <p className="text-warn">{QUOTE_ERRORS[quote.reason]}</p>
        ) : (
          <QuoteRows q={quote} mode={mode} lmsr />
        )}
        {mode === "buy" && quote?.ok && quote.total > viewer.cash ? <p className="text-warn">That&apos;s more than your {usd(viewer.cash)} cash.</p> : null}
      </div>

      {message ? (
        <p role="status" className={`mt-2 rounded-lg px-3 py-2 text-sm ${message.kind === "ok" ? "bg-yes/10 text-yes" : "bg-no/10 text-no"}`}>
          {message.text}
        </p>
      ) : null}

      <button
        onClick={requestQuote}
        disabled={busy || !!blocked || !quote?.ok || (mode === "buy" && quote.total > viewer.cash)}
        className="mt-3 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-bg disabled:opacity-40"
      >
        {busy && !confirming ? "Getting a fresh price…" : `${mode === "buy" ? "Buy" : "Sell"} "${market.outcomes[index]}"`}
      </button>

      {confirming ? <ConfirmSheet c={confirming} mode={mode} busy={busy} onCancel={() => setConfirming(null)} onConfirm={execute} lmsr /> : null}
    </div>
  );
}
