import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomMarketView } from "@/components/custom/CustomMarketView";
import { customMarketTimeZone, customTab } from "@/config/site";
import { formatInZone } from "@/lib/tz";
import { getCurrentUser } from "@/lib/auth/session";
import { getCustomBySlug } from "@/lib/custom/markets";
import { customConditionId } from "@/lib/custom/types";
import { compactUsd, timeLeft } from "@/lib/format";
import { loadHolders } from "@/lib/holders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: customTab.label, robots: { index: false, follow: false } };

// Members only. Logged-out visitors get a plain 404, so they can't tell these exist.
export default async function CustomMarketPage(props: PageProps<"/leahys/[slug]">) {
  const user = await getCurrentUser();
  if (!user) notFound();
  const { slug } = await props.params;
  const market = await getCustomBySlug(slug);
  if (!market || (market.status === "draft" && !user.isAdmin)) notFound();

  const holders = await loadHolders([customConditionId(market.id)], user.id);
  const holdings = Object.fromEntries(holders.filter((h) => h.isYou).map((h) => [h.tokenId, h.shares]));
  const ends = market.status === "open" && !market.ended ? timeLeft(market.endAt) : null;

  return (
    <div>
      <header className="mb-4">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">
          {customTab.label}
          {market.status === "draft" ? <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-warn">draft</span> : null}
        </div>
        <h1 className="text-xl font-bold leading-tight sm:text-2xl">{market.title}</h1>
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
          <span>{compactUsd(market.volume)} traded</span>
          {ends ? <span>{ends}</span> : null}
          <span>
            {market.ended ? "Ended" : "Ends"} {formatInZone(market.endAt, customMarketTimeZone.zone)}
          </span>
          {market.status === "cancelled" ? <span className="text-warn">Cancelled</span> : null}
          <span>{market.outcomes.length} outcomes</span>
        </div>
      </header>
      <CustomMarketView market={market} viewer={{ cash: user.cash, holdings, isAdmin: user.isAdmin }} holders={holders} />
    </div>
  );
}
