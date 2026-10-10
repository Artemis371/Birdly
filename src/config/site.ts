// Single place to change Birdly's name, tagline, colors and trading knobs.
// Colors here are mirrored as CSS variables in src/app/globals.css via
// the <style> tag rendered in src/app/layout.tsx, so edit them only here.

export const site = {
  name: "Birdly",
  tagline: "Call it early. Paper money, real odds.",
  description:
    "A private paper-money prediction market for friends and family. No real money, ever.",
  dataCredit: "Market data: Polymarket",

  colors: {
    // Brand accent: a blue-leaning teal, kept well away from the Yes green.
    accent: "#22C3E6",
    accentStrong: "#0EA5C9",
    yes: "#3FCF6E",
    no: "#F0505A",
    bg: "#0B0E13",
    surface: "#131821",
    surface2: "#1A212D",
    border: "#252E3C",
    text: "#E8ECF2",
    muted: "#8A96A8",
    warn: "#F5B942",
  },
} as const;

export const trading = {
  startingBalance: 10_000,
  // Max dollars spent (buy) or received (sell) in a single trade.
  maxTradeUsd: 2_000,
  // Walk the real book at most this far (in dollars per share) past the best price.
  maxSlippage: 0.05,
  // Reject execution if the average fill price moved more than this vs the quote.
  quoteTolerance: 0.02,
  // Prices at or beyond these are treated as unusable quotes (market effectively decided).
  minPrice: 0.001,
  maxPrice: 0.999,
} as const;

// How often things refresh. Every number here can be tuned without touching
// code. Polling only runs while the tab is visible and the person isn't idle.
// Usage math behind these numbers: see "Live refresh" in the README.
export const refresh = {
  // Browser polling intervals (ms).
  livePricesMs: 5_000, // market page prices + trade panel quote preview
  chartMs: 15_000, // market page chart
  gridMs: 20_000, // home page and category grids
  accountMs: 15_000, // top bar Portfolio/Cash, leaderboard, portfolio page
  activityMs: 10_000, // activity feed (top bar refreshes in the same request)
  customLiveMs: 4_000, // Leahys market prices + quote preview
  // Stop polling after this long with no mouse, touch or keyboard activity.
  idleTimeoutMs: 5 * 60_000,
  // After a failed refresh, wait interval x 2, x 4, ... up to this cap.
  maxBackoffMs: 60_000,
} as const;

export const cacheTtl = {
  // Server-side in-memory cache lifetimes (seconds), shared by everyone on a
  // server instance. Many people watching the same market share one request.
  eventList: 15, // home grids
  event: 20, // event/market details (prices come from books, not this)
  book: 2, // order books: live prices, quote previews, card prices
  history: 10, // chart history
  tags: 3600,
  accountPrices: 10, // bids used for Portfolio values (top bar, leaderboard, portfolio)
  // Vercel CDN cache (s-maxage, seconds) on our public API routes. Stacks on
  // top of the in-memory cache, so keep both short for prices.
  cdnLive: 2, // /api/event/[slug]/live
  cdnQuote: 2, // /api/quote (preview only; execution always re-prices fresh)
  cdnHistory: 10, // /api/history
} as const;

// Backoff when Polymarket errors or rate-limits us (HTTP 429 or 5xx, timeouts):
// skip calls for 1s, then 2s, 4s ... up to this cap, serving last known data
// marked stale. Trade execution is exempt and always fetches a fresh book.
export const upstreamBackoff = { firstMs: 1_000, maxMs: 60_000 } as const;

// Category chips on the home page. `slug` is the Polymarket tag slug used to
// filter events. Unverified guesses until checked against GET /tags; edit freely.
export const categories = [
  { label: "Trending", slug: "" },
  { label: "Politics", slug: "politics" },
  { label: "Sports", slug: "sports" },
  { label: "Crypto", slug: "crypto" },
  { label: "Economy", slug: "economy" },
  { label: "Tech", slug: "tech" },
  { label: "Culture", slug: "pop-culture" },
  { label: "World", slug: "world" },
] as const;

// Custom market tabs (Leahys, Rooneys, ...) live in the database and are
// managed on the admin page. This is only used if that table is missing
// (migration 0007 not run yet): one Leahys tab with every custom market.
export const fallbackCustomCategory = { label: "Leahys", slug: "leahys" } as const;

// Time zone for custom ("Leahys") market end dates: what the admin types in
// the edit form and what everyone sees on market pages.
export const customMarketTimeZone = { zone: "Pacific/Honolulu", label: "Hawaii time" } as const;
