"use client";

import Link from "@/components/Link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Flash } from "@/components/Flash";
import { InfoTooltip } from "@/components/InfoTooltip";
import { refresh } from "@/config/site";
import { fetchJson, usePolling } from "@/lib/client/usePolling";
import { usd } from "@/lib/format";
import type { AccountSummary } from "@/lib/account-value";

function staleTitle(asOf: number | null): string {
  if (asOf === null) return "Live prices are unavailable right now, so this is the last known value.";
  const min = Math.max(1, Math.round((Date.now() - asOf) / 60_000));
  return `Live prices are delayed. Showing the last known value (prices from about ${min} min ago).`;
}

// Top bar "Portfolio" and "Cash". The server renders the first value; after
// that it refetches on every navigation, because Next keeps the layout (and
// this component) mounted across page changes. A trade calls router.refresh(),
// which hands down a newer server value, so whichever is newer wins.
export function AccountChip({ initial }: { initial: AccountSummary | null }) {
  const path = usePathname();
  const search = useSearchParams().toString();
  const navKey = `${path}?${search}`;
  // No server value (it failed)? Then fetch right away instead of waiting.
  const firstKey = useRef(initial ? navKey : "");
  const [fetched, setFetched] = useState<AccountSummary | null>(null);
  // When we last received a value (browser clock, so server clock skew can't matter).
  const receivedAt = useRef(0);
  const initialAt = initial?.computedAt;
  useEffect(() => {
    receivedAt.current = Date.now();
  }, [initialAt]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const s = await fetchJson<AccountSummary>("/api/account/summary", signal);
    if (typeof s.total === "number") {
      receivedAt.current = Date.now();
      setFetched(s);
    }
  }, []);

  // Navigation keeps this component mounted, so refetch on page changes.
  useEffect(() => {
    if (navKey === firstKey.current) return; // the server just rendered this
    firstKey.current = "";
    const ctrl = new AbortController();
    load(ctrl.signal).catch(() => {}); // keep showing the last value we had
    return () => ctrl.abort();
  }, [navKey, load]);

  // And every refresh.accountMs while the person is here. Pages that refresh
  // themselves (leaderboard, portfolio, activity) hand down a fresh server
  // value, in which case this tick is skipped rather than doubled up.
  usePolling(async (signal) => {
    if (Date.now() - receivedAt.current < refresh.accountMs * 0.8) return;
    await load(signal);
  }, refresh.accountMs);

  const s = fetched && (!initial || fetched.computedAt > initial.computedAt) ? fetched : initial;
  if (!s) return null;
  return (
    <div className="ml-1 flex items-center gap-1 rounded-lg bg-surface px-2.5 py-1 leading-tight">
      <div className="flex flex-col items-end">
        <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted">
          Portfolio
          <InfoTooltip align="right" label="What is Portfolio?" />
        </span>
        <Link href="/portfolio" className="tabular flex items-center gap-1 text-sm font-semibold text-text hover:text-accent">
          {s.stale ? <span className="h-1.5 w-1.5 rounded-full bg-warn" title={staleTitle(s.asOf)} aria-label="Prices delayed, last known value" /> : null}
          <Flash value={s.total}>{usd(s.total)}</Flash>
        </Link>
      </div>
      <div className="ml-2 hidden flex-col items-end border-l border-line pl-3 md:flex">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Cash</span>
        <Link href="/account" className="tabular text-sm font-semibold text-text hover:text-accent">
          <Flash value={s.cash}>{usd(s.cash)}</Flash>
        </Link>
      </div>
    </div>
  );
}
