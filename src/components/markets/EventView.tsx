"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { refresh } from "@/config/site";
import { cents, compactUsd, pct } from "@/lib/format";
import { marketBlockReason, orderMarkets, type LiveMarket, type LiveResponse } from "@/lib/polymarket/display";
import type { PolyEvent } from "@/lib/polymarket/types";
import { PriceChart } from "./PriceChart";
import { TradePanel } from "./TradePanel";

const INITIAL_ROWS = 12;

type Props = { ev: PolyEvent; initialLive: LiveResponse | null; initialMarketId?: string; initialSide?: "yes" | "no" };

export function EventView({ ev, initialLive, initialMarketId, initialSide }: Props) {
  const markets = useMemo(() => orderMarkets(ev.markets, ev.negRisk), [ev]);
  const [live, setLive] = useState<LiveResponse | null>(initialLive);
  const [liveError, setLiveError] = useState(initialLive === null);
  const [selectedId, setSelectedId] = useState(
    markets.some((m) => m.id === initialMarketId) ? initialMarketId! : markets[0]?.id,
  );
  const [outcomeIndex, setOutcomeIndex] = useState<0 | 1>(initialSide === "no" ? 1 : 0);
  const [showAll, setShowAll] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/event/${ev.slug}/live`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as LiveResponse;
        if (!cancelled) {
          setLive(body);
          setLiveError(false);
        }
      } catch {
        if (!cancelled) setLiveError(true);
      }
    }
    const id = setInterval(poll, refresh.livePricesMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ev.slug]);

  const liveById = useMemo(() => new Map((live?.markets ?? []).map((m) => [m.id, m])), [live]);
  const selected = markets.find((m) => m.id === selectedId) ?? markets[0];
  const stale = liveError || live?.stale === true;

  const select = useCallback(
    (id: string, side?: 0 | 1) => {
      setSelectedId(id);
      if (side !== undefined) setOutcomeIndex(side);
      router.replace(`${pathname}?m=${id}${side === 1 ? "&side=no" : ""}`, { scroll: false });
      if (side !== undefined && window.innerWidth < 1024) document.getElementById("trade")?.scrollIntoView({ behavior: "smooth" });
    },
    [pathname, router],
  );

  if (!selected) {
    return <p className="rounded-2xl border border-line bg-surface p-6 text-muted">All markets in this event have closed.</p>;
  }

  const blocked = stale ? "Live prices are unavailable right now, so trading is paused." : marketBlockReason(selected);
  const rows = showAll ? markets : markets.slice(0, INITIAL_ROWS);
  const multi = markets.length > 1;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-4">
        {stale ? (
          <div role="status" className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
            Can&apos;t reach live prices right now. Showing the last known prices
            {live ? ` from ${new Date(live.fetchedAt).toLocaleTimeString()}` : ""}. Trading is paused until they&apos;re back.
          </div>
        ) : null}

        <div className="rounded-2xl border border-line bg-surface p-4">
          <PriceChart key={selected.outcomes[0].tokenId} tokenId={selected.outcomes[0].tokenId} liveProb={stale ? null : liveById.get(selected.id)?.prob} label={multi ? `${selected.label} · ${selected.outcomes[0].name}` : selected.outcomes[0].name} />
        </div>

        {multi ? (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-muted">
              <span>Outcome</span>
              <span>Chance</span>
            </div>
            <ul className="divide-y divide-line">
              {rows.map((m) => (
                <OutcomeRow key={m.id} m={m} live={liveById.get(m.id)} active={m.id === selected.id} onSelect={select} />
              ))}
            </ul>
            {markets.length > INITIAL_ROWS ? (
              <button onClick={() => setShowAll((v) => !v)} className="w-full border-t border-line py-2.5 text-sm text-accent">
                {showAll ? "Show fewer" : `Show all ${markets.length}`}
              </button>
            ) : null}
          </div>
        ) : null}

        {ev.description ? (
          <details className="rounded-2xl border border-line bg-surface p-4 text-sm">
            <summary className="cursor-pointer font-semibold">Rules</summary>
            <p className="mt-3 whitespace-pre-line text-muted">{ev.description}</p>
          </details>
        ) : null}
      </div>

      <aside id="trade" className="lg:sticky lg:top-20 lg:self-start">
        <TradePanel market={selected} live={liveById.get(selected.id)} outcomeIndex={outcomeIndex} onOutcome={setOutcomeIndex} blockedReason={blocked} />
      </aside>
    </div>
  );
}

function OutcomeRow({ m, live, active, onSelect }: { m: PolyEvent["markets"][number]; live: LiveMarket | undefined; active: boolean; onSelect: (id: string, side?: 0 | 1) => void }) {
  const prob = live?.prob ?? m.outcomes[0].price;
  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${active ? "bg-surface-2" : ""}`}>
      <button onClick={() => onSelect(m.id)} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-medium">{m.label}</div>
        <div className="text-xs text-muted">{compactUsd(m.volume)} vol</div>
      </button>
      <span className="tabular w-12 text-right text-lg font-bold">{pct(prob)}</span>
      <div className="flex shrink-0 gap-1.5">
        <button onClick={() => onSelect(m.id, 0)} className="rounded-lg bg-yes/15 px-2.5 py-2 text-xs font-semibold text-yes hover:bg-yes/25 sm:px-3">
          <span className="hidden sm:inline">{m.outcomes[0].name} </span>
          {cents(live?.yes.ask ?? null)}
        </button>
        <button onClick={() => onSelect(m.id, 1)} className="rounded-lg bg-no/15 px-2.5 py-2 text-xs font-semibold text-no hover:bg-no/25 sm:px-3">
          <span className="hidden sm:inline">{m.outcomes[1]?.name} </span>
          {cents(live?.no.ask ?? null)}
        </button>
      </div>
    </li>
  );
}
