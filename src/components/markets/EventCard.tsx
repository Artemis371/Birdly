import Link from "next/link";
import { compactUsd, cents, pct, timeLeft } from "@/lib/format";
import { displayProb, orderMarkets } from "@/lib/polymarket/display";
import type { OrderBook, PolyEvent } from "@/lib/polymarket/types";
import { EventThumb } from "./EventThumb";

export const CARD_ROWS = 3;

// Token ids a card shows prices for, so the page can batch-fetch their books.
export function cardTokenIds(ev: PolyEvent): string[] {
  const markets = orderMarkets(ev.markets, ev.negRisk);
  if (markets.length === 1) return markets[0].outcomes.slice(0, 2).map((o) => o.tokenId);
  return markets.slice(0, CARD_ROWS).map((m) => m.outcomes[0].tokenId);
}

export function EventCard({ ev, books }: { ev: PolyEvent; books: Record<string, OrderBook> }) {
  const markets = orderMarkets(ev.markets, ev.negRisk);
  const single = markets.length === 1 ? markets[0] : null;
  const href = `/event/${ev.slug}`;
  const ends = timeLeft(ev.endDate);

  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-muted/40">
      <Link href={href} className="flex items-start gap-3">
        <EventThumb src={ev.image} alt="" />
        <h3 className="line-clamp-2 flex-1 text-[15px] font-semibold leading-snug">{ev.title}</h3>
        {single ? <Gauge p={displayProb(books[single.outcomes[0].tokenId], single.outcomes[0].price)} /> : null}
      </Link>

      <div className="mt-3 flex-1">
        {single ? (
          <div className="grid grid-cols-2 gap-2">
            {single.outcomes.slice(0, 2).map((o, i) => (
              <Link
                key={o.tokenId}
                href={`${href}?m=${single.id}&side=${i === 0 ? "yes" : "no"}`}
                className={`truncate rounded-lg px-3 py-2.5 text-center text-sm font-semibold ${
                  i === 0 ? "bg-yes/15 text-yes hover:bg-yes/25" : "bg-no/15 text-no hover:bg-no/25"
                }`}
              >
                Buy {o.name} {cents(books[o.tokenId]?.bestAsk ?? o.price)}
              </Link>
            ))}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {markets.slice(0, CARD_ROWS).map((m) => (
              <li key={m.id}>
                <Link href={`${href}?m=${m.id}`} className="flex items-center gap-2 rounded-lg py-1 text-sm hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate text-text/90">{m.label}</span>
                  <span className="tabular w-12 text-right font-semibold">
                    {pct(displayProb(books[m.outcomes[0].tokenId], m.outcomes[0].price))}
                  </span>
                  <span className="max-w-16 truncate rounded-md bg-yes/15 px-2 py-0.5 text-xs font-semibold text-yes">{m.outcomes[0].name}</span>
                  <span className="max-w-16 truncate rounded-md bg-no/15 px-2 py-0.5 text-xs font-semibold text-no">{m.outcomes[1]?.name}</span>
                </Link>
              </li>
            ))}
            {markets.length > CARD_ROWS ? <li className="pt-0.5 text-xs text-muted">+{markets.length - CARD_ROWS} more</li> : null}
          </ul>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>{compactUsd(ev.volume)} vol</span>
        {ends ? <span>{ends}</span> : null}
      </div>
    </article>
  );
}

function Gauge({ p }: { p: number | null }) {
  const v = p === null ? 0 : Math.min(1, Math.max(0, p));
  const r = 20;
  const circ = Math.PI * r;
  return (
    <div className="relative -mt-1 h-[34px] w-[52px] shrink-0" aria-label={`${pct(p)} chance`}>
      <svg viewBox="0 0 52 30" className="h-full w-full">
        <path d="M6 26 A20 20 0 0 1 46 26" fill="none" stroke="var(--surface-2)" strokeWidth="5" strokeLinecap="round" />
        <path
          d="M6 26 A20 20 0 0 1 46 26"
          fill="none"
          stroke={v >= 0.5 ? "var(--yes)" : "var(--no)"}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${circ * v} ${circ}`}
        />
      </svg>
      <span className="tabular absolute inset-x-0 bottom-0 text-center text-xs font-bold leading-none">{pct(p)}</span>
    </div>
  );
}
