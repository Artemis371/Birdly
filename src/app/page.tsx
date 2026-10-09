import Link from "next/link";
import { ErrorPanel, StaleBanner } from "@/components/StaleBanner";
import { EventCard, cardTokenIds } from "@/components/markets/EventCard";
import { categories } from "@/config/site";
import { SORTS, type SortKey, getBooks, listEvents, searchEvents, type EventPage } from "@/lib/polymarket/api";
import type { Fetched, OrderBook } from "@/lib/polymarket/types";

export const dynamic = "force-dynamic";

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function Home(props: PageProps<"/">) {
  const sp = await props.searchParams;
  const q = first(sp.q).trim();
  const tag = first(sp.tag);
  const sortParam = first(sp.sort) as SortKey;
  const sort: SortKey = SORTS.some((s) => s.key === sortParam) ? sortParam : "trending";
  const cursor = first(sp.cursor) || undefined;

  let page: Fetched<EventPage> | null = null;
  try {
    page = q ? await searchEvents(q) : await listEvents({ sort, tag, cursor });
  } catch {
    page = null;
  }

  let books: Fetched<Record<string, OrderBook>> | null = null;
  if (page && page.data.events.length) {
    try {
      books = await getBooks(page.data.events.flatMap(cardTokenIds));
    } catch {
      books = null; // cards fall back to Gamma's (slightly delayed) prices
    }
  }

  const href = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { tag: tag || undefined, sort: sort === "trending" ? undefined : sort, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <div>
      <form action="/" className="mb-3">
        <label htmlFor="q" className="sr-only">
          Search markets
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Search markets"
          enterKeyHint="search"
          className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-[16px] outline-none placeholder:text-muted focus:border-accent sm:text-sm"
        />
      </form>

      {!q ? (
        <>
          <div className="no-scrollbar -mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4">
            {categories.map((c) => {
              const active = (c.slug || "") === tag;
              return (
                <Link
                  key={c.label}
                  href={href({ tag: c.slug || undefined, cursor: undefined })}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
                    active ? "bg-accent text-bg" : "bg-surface text-muted hover:text-text"
                  }`}
                >
                  {c.label}
                </Link>
              );
            })}
          </div>
          <div className="mb-4 flex gap-4 border-b border-line text-sm">
            {SORTS.map((s) => (
              <Link
                key={s.key}
                href={href({ sort: s.key === "trending" ? undefined : s.key, cursor: undefined })}
                className={`-mb-px border-b-2 pb-2 ${s.key === sort ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}
              >
                {s.label}
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="mb-4 flex items-center justify-between text-sm text-muted">
          <span>Results for &ldquo;{q}&rdquo;</span>
          <Link href="/" className="text-accent">
            Clear
          </Link>
        </div>
      )}

      {page?.stale || books?.stale ? <StaleBanner fetchedAt={Math.min(page?.fetchedAt ?? Infinity, books?.fetchedAt ?? Infinity)} /> : null}

      {!page ? (
        <ErrorPanel title="Markets are unavailable right now">Live market data couldn&apos;t be loaded. Try again in a minute.</ErrorPanel>
      ) : page.data.events.length === 0 ? (
        <ErrorPanel title="No markets found">{q ? "Try a different search." : "Nothing open in this category right now."}</ErrorPanel>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {page.data.events.map((ev) => (
              <EventCard key={ev.id} ev={ev} books={books?.data ?? {}} />
            ))}
          </div>
          {page.data.nextCursor ? (
            <div className="mt-6 flex justify-center gap-3">
              {cursor ? (
                <Link href={href({ cursor: undefined })} className="rounded-xl border border-line px-5 py-2.5 text-sm text-muted hover:text-text">
                  Back to top
                </Link>
              ) : null}
              <Link href={href({ cursor: page.data.nextCursor })} className="rounded-xl bg-surface-2 px-5 py-2.5 text-sm font-medium hover:bg-line">
                More markets
              </Link>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
