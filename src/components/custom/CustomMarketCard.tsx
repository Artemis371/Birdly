import Link from "next/link";
import { BirdMark } from "@/components/brand/Logo";
import type { CustomMarket } from "@/lib/custom/types";
import { compactUsd, pct, timeLeft } from "@/lib/format";

const ROWS = 3;

export function CustomMarketCard({ m }: { m: CustomMarket }) {
  const href = `/leahys/${m.slug}`;
  const resolved = m.status === "resolved";
  const order = m.outcomes.map((name, i) => ({ name, i })).sort((a, b) => m.prices[b.i] - m.prices[a.i]);
  const cancelled = m.status === "cancelled";
  const status = cancelled ? "Cancelled, refunded" : resolved ? `Resolved: ${m.outcomes[m.winningIndex ?? 0]}` : m.ended ? "Trading closed" : timeLeft(m.endAt);

  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-muted/40">
      <Link href={href} className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/10" aria-hidden="true">
          <BirdMark className="h-6 w-6" />
        </div>
        <h3 className="line-clamp-2 flex-1 text-[15px] font-semibold leading-snug">{m.title}</h3>
      </Link>
      <ul className="mt-3 flex-1 space-y-1.5">
        {(cancelled ? [] : resolved ? order.filter((o) => o.i === m.winningIndex) : order.slice(0, ROWS)).map((o) => (
          <li key={o.i}>
            <Link href={href} className="flex items-center gap-2 rounded-lg py-1 text-sm hover:bg-surface-2">
              <span className="min-w-0 flex-1 truncate text-text/90">{o.name}</span>
              <span className="tabular w-12 text-right font-semibold">{resolved ? "100%" : pct(m.prices[o.i])}</span>
              {!resolved && !m.ended ? <span className="rounded-md bg-yes/15 px-2 py-0.5 text-xs font-semibold text-yes">Buy</span> : null}
            </Link>
          </li>
        ))}
        {!resolved && !cancelled && m.outcomes.length > ROWS ? <li className="pt-0.5 text-xs text-muted">+{m.outcomes.length - ROWS} more</li> : null}
      </ul>
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>{compactUsd(m.volume)} traded</span>
        {status ? <span className={resolved ? "text-yes" : cancelled ? "text-muted" : m.ended ? "text-warn" : ""}>{status}</span> : null}
      </div>
    </article>
  );
}
