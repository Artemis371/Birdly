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

export const refresh = {
  // Browser polling intervals (ms) for the market page.
  livePricesMs: 15_000,
  chartMs: 30_000,
} as const;

export const cacheTtl = {
  // Server-side cache lifetimes (seconds).
  eventList: 60,
  event: 20,
  book: 5,
  history: 30,
  tags: 3600,
} as const;

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

// Our own private markets tab (members only). Shown second in the category row.
export const customTab = { label: "Leahys", slug: "leahys" } as const;
