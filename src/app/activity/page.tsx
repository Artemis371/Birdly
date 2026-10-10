import type { Metadata } from "next";
import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { refresh } from "@/config/site";
import { getCurrentUser } from "@/lib/auth/session";
import { ACTIVITY_PAGE, loadActivity, type ActivityItem } from "@/lib/activity";
import { cents, nowMs, shares, usd } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activity" };

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Line({ a }: { a: ActivityItem }) {
  if (a.kind === "refund") {
    return (
      <>
        <span className="font-semibold">{a.displayName}</span> got {usd(a.amount)} back (market cancelled)
      </>
    );
  }
  if (a.kind === "payout") {
    const won = a.price >= 1;
    const split = a.price > 0 && a.price < 1;
    return (
      <>
        <span className="font-semibold">{a.displayName}</span>{" "}
        {won ? (
          <span className="text-yes">won {usd(a.amount)}</span>
        ) : split ? (
          <span>got {usd(a.amount)} back on a 50/50</span>
        ) : (
          <span className="text-no">lost</span>
        )}{" "}
        on &ldquo;{a.outcomeName}&rdquo;
      </>
    );
  }
  return (
    <>
      <span className="font-semibold">{a.displayName}</span> {a.kind === "buy" ? "bought" : "sold"} {shares(a.shares)}{" "}
      <span className={a.kind === "buy" ? "text-accent" : "text-warn"}>&ldquo;{a.outcomeName}&rdquo;</span> at {cents(a.price)} ({usd(a.amount)})
    </>
  );
}

export default async function ActivityPage(props: PageProps<"/activity">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/activity");
  const sp = await props.searchParams;
  const before = typeof sp.before === "string" && /^\d+$/.test(sp.before) ? Number(sp.before) : undefined;
  const items = await loadActivity(before);
  const now = nowMs();

  return (
    <div className="mx-auto max-w-2xl">
      <AutoRefresh ms={refresh.activityMs} />
      <h1 className="mb-4 text-2xl font-bold">Activity</h1>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-muted">No trades yet. Somebody has to go first.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {items.map((a) => (
            <li key={a.id}>
              <Link href={a.href} className="block px-4 py-3 text-sm hover:bg-surface-2">
                <div>
                  <Line a={a} />
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">
                  {a.label !== a.eventTitle && a.eventTitle ? `${a.eventTitle} · ` : ""}
                  {a.label} · {ago(a.createdAt, now)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {items.length === ACTIVITY_PAGE ? (
        <div className="mt-4 text-center">
          <Link href={`/activity?before=${items[items.length - 1].id}`} className="rounded-xl bg-surface-2 px-5 py-2.5 text-sm font-medium hover:bg-line">
            Older
          </Link>
        </div>
      ) : null}
    </div>
  );
}
