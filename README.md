# Birdly

A private, paper-money prediction market for a small group of friends and
family. Trade fake dollars against real, live odds. **No real money, ever.**

Market data comes from Polymarket's public APIs (credited in the footer).
Birdly never places real orders.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Market browsing, market page, live prices, charts (no auth) | **Ready to test** |
| 2 | Auth (invite code), balances, buying/selling, portfolio | Not started |
| 3 | Automatic resolution and payouts | Not started |
| 4 | Leaderboard, activity feed, polish, deploy | Not started |

## Change the brand in one place

`src/config/site.ts` holds the app name, tagline, colors (accent teal, Yes
green, No red, surfaces), the footer data credit, trading limits
(`maxTradeUsd`, `maxSlippage`, `quoteTolerance`), refresh intervals, cache
lifetimes, and the home page category chips. The favicon and logo read their
colors from it too.

## Run it locally

Requires Node 20.9+ (tested on Node 22).

```bash
npm install
npm run dev        # http://localhost:3000
```

Phase 1 needs no environment variables and no database.

Checks:

```bash
npm test           # vitest: order-book math, parsers (on real captured API responses), cache fallback
npm run typecheck
npm run lint
npm run build
```

## Deploy to Vercel (free Hobby plan)

1. Push this repo to GitHub (already done if you're reading this on GitHub).
2. Go to https://vercel.com/new, sign in with GitHub, and **Import** the
   `birdly` repository.
3. Framework preset: **Next.js** (auto-detected). Leave build settings as
   default. No environment variables are needed for Phase 1.
4. Click **Deploy**. Every push to a branch creates a preview URL; pushes to
   the default branch update production.
5. After the first deploy, open `https://<your-deploy>/api/health/polymarket`.
   `"dataEndpointsOk": true` means Vercel's servers can reach Polymarket's data
   APIs (no geoblocking of reads). The `polymarket geoblock` row is Polymarket's
   own trading check, informational only.

## How it works (Phase 1)

- **The browser never calls Polymarket.** Pages and `/api/*` routes call
  Polymarket server-side (`src/lib/polymarket/`), with an in-memory cache plus
  CDN `Cache-Control` headers.
- **Live prices come from real CLOB order books**, not Gamma's displayed
  prices (Gamma is CDN-cached about 5 minutes).
- **If Polymarket is down,** pages show the last good data with a warning and
  the trade panel is disabled. If there's no cached data, you get a friendly
  error instead of a crash.
- **Quote preview:** the trade panel walks the real order book: buys fill at
  the real asks starting at the best ask, sells at the real bids starting at the
  best bid, at most `maxSlippage` (5¢) past the best price and `maxTradeUsd`
  ($2,000) per trade. Never midpoint, never last trade. In Phase 1 this is a
  preview only; the button is disabled.
- Market page charts poll every 30 s, live prices every 15 s (only while the
  tab is visible).

API research and every live-verified quirk: [`docs/API_NOTES.md`](docs/API_NOTES.md).

## Project layout

```
src/config/site.ts            brand, colors, trading limits, categories
src/lib/polymarket/api.ts     every Polymarket endpoint + parameter we use
src/lib/polymarket/parse.ts   raw API -> typed objects (tests use real fixtures)
src/lib/polymarket/client.ts  server-only fetch + cache + stale fallback
src/lib/trading/quote.ts      order-book walking math (buy/sell/caps/rounding)
src/app/                      pages and /api routes
src/components/               UI (cards, chart, trade panel, logo)
```
