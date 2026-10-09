import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ErrorPanel } from "@/components/StaleBanner";
import { EventThumb } from "@/components/markets/EventThumb";
import { EventView } from "@/components/markets/EventView";
import { compactUsd, timeLeft } from "@/lib/format";
import { getBooks, getEvent } from "@/lib/polymarket/api";
import { orderMarkets, toLive, type LiveResponse } from "@/lib/polymarket/display";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/event/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  try {
    const ev = await getEvent(slug);
    return { title: ev.data?.title ?? "Market" };
  } catch {
    return { title: "Market" };
  }
}

export default async function EventPage(props: PageProps<"/event/[slug]">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const m = typeof sp.m === "string" ? sp.m : undefined;
  const side = sp.side === "no" ? "no" : sp.side === "yes" ? "yes" : undefined;

  let ev;
  try {
    ev = await getEvent(slug);
  } catch {
    return <ErrorPanel title="This market is unavailable right now">Live market data couldn&apos;t be loaded. Try again in a minute.</ErrorPanel>;
  }
  if (!ev.data) notFound();
  const event = ev.data;

  let initialLive: LiveResponse | null = null;
  try {
    const markets = orderMarkets(event.markets, event.negRisk).slice(0, 100);
    const books = await getBooks(markets.flatMap((x) => x.outcomes.slice(0, 2).map((o) => o.tokenId)));
    initialLive = {
      fetchedAt: Math.min(ev.fetchedAt, books.fetchedAt),
      stale: ev.stale || books.stale,
      markets: markets.map((x) => toLive(x, books.data)),
    };
  } catch {
    initialLive = null;
  }

  const ends = timeLeft(event.endDate);
  return (
    <div>
      <header className="mb-4 flex items-start gap-3">
        <EventThumb src={event.image} alt="" size={56} />
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">{event.title}</h1>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
            <span>{compactUsd(event.volume)} vol</span>
            {ends ? <span>{ends}</span> : null}
            {event.tags.slice(0, 3).map((t) => (
              <span key={t.slug}>#{t.label || t.slug}</span>
            ))}
          </div>
        </div>
      </header>
      <EventView ev={event} initialLive={initialLive} initialMarketId={m} initialSide={side} />
    </div>
  );
}
