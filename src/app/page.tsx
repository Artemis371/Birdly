import Link from "@/components/Link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ErrorPanel, StaleBanner } from "@/components/StaleBanner";
import { EventCard, cardTokenIds } from "@/components/markets/EventCard";
import { CustomMarketCard } from "@/components/custom/CustomMarketCard";
import { categories, customTab, refresh } from "@/config/site";
import { getCurrentUser } from "@/lib/auth/session";
import { countCustomDrafts, listPublishedCustom } from "@/lib/custom/markets";
import type { CustomMarket } from "@/lib/custom/types";
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

  // The custom-markets tab only exists for signed-in members.
  let user = null;
  try {
    user = await getCurrentUser();
  } catch {}
  const showCustom = !q && !!user && tag === customTab.slug;
  const chips = user ? [categories[0], { label: customTab.label, slug: customTab.slug }, ...categories.slice(1)] : [...categories];

  if (showCustom && user) {
    let custom: CustomMarket[] | null = null;
    let drafts = 0;
    try {
      [custom, drafts] = await Promise.all([listPublishedCustom(), user.isAdmin ? countCustomDrafts() : Promise.resolve(0)]);
    } catch {
      custom = null;
    }
    return (
      <div>
        <AutoRefresh ms={refresh.gridMs} />
        <Chips chips={chips} active={tag} />
        <p className="mb-4 text-sm text-muted">Our own private markets. Only members can see these.</p>
        {user.isAdmin ? (
          <Link
            href="/admin/leahys"
            className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm"
          >
            <span>
              <span className="font-semibold text-accent">Admin:</span>{" "}
              {drafts ? `${drafts} draft${drafts === 1 ? "" : "s"} not published yet.` : "Create, publish and resolve these markets."}
            </span>
            <span className="shrink-0 font-semibold text-accent">Manage {customTab.label} markets →</span>
          </Link>
        ) : null}
        {!custom ? (
          <ErrorPanel title="Couldn't load these right now">Try again in a minute.</ErrorPanel>
        ) : custom.length === 0 ? (
          <ErrorPanel title="No markets here yet">{user.isAdmin ? "Publish a draft with the link above and it shows up here." : "Check back soon."}</ErrorPanel>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {custom.map((m) => (
              <CustomMarketCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </div>
    );
  }

  let page: Fetched<EventPage> | null = null;
  try {
    page = q ? await searchEvents(q) : await listEvents({ sort, tag: tag === customTab.slug ? undefined : tag, cursor });
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
      <AutoRefresh ms={refresh.gridMs} />
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
          <Chips chips={chips} active={tag} href={(slug) => href({ tag: slug || undefined, cursor: undefined })} />
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

function Chips({ chips, active, href }: { chips: { label: string; slug: string }[]; active: string; href?: (slug: string) => string }) {
  return (
    <div className="no-scrollbar -mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4 pb-2">
      {chips.map((c) => (
        <Link
          key={c.label}
          href={href ? href(c.slug) : c.slug ? `/?tag=${c.slug}` : "/"}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
            (c.slug || "") === active ? "bg-accent text-bg" : "bg-surface text-muted hover:text-text"
          }`}
        >
          {c.label}
        </Link>
      ))}
    </div>
  );
}
