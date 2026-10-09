# Birdly API Notes

Research date: 2026-10-09. Everything below should be re-checked against the
live docs before relying on it, because Polymarket and Vercel both change
things often (Polymarket shipped "CLOB V2" in April 2026).

## How this was researched (read this first)

The build sandbox's network policy blocks `docs.polymarket.com`,
`gamma-api.polymarket.com`, `clob.polymarket.com` and `vercel.com`. So I could
NOT hit the live API or read the docs pages directly. Instead:

- **Primary source:** Polymarket's own open source code, which is reachable:
  - `Polymarket/clob-client-v2` on GitHub (`src/endpoints.ts`, `src/types/clob.ts`, `src/client.ts`)
  - `Polymarket/py-clob-client` on GitHub (`endpoints.py`, `client.py`)
  - `@polymarket/bindings@0.12.0` and `@polymarket/client@0.12.0` on npm (official
    generated schemas for Gamma and CLOB responses and request params)
- **Secondary:** web search snippets of docs.polymarket.com and vercel.com pages.
- **Tertiary (flagged where used):** third party guides.

Confidence tags used below: **[code]** = confirmed in Polymarket's official
code/schemas, **[docs-snippet]** = from official docs via search snippet,
**[3rd-party]** = community source, treat as unverified.

To let me test against the real API while building, add these hosts to the
cloud environment's allowed domains: `gamma-api.polymarket.com`,
`clob.polymarket.com`, `docs.polymarket.com`.

---

## 1. Which APIs we use

| API | Base URL | Used for |
|---|---|---|
| Gamma | `https://gamma-api.polymarket.com` | Events, markets, tags, search, resolution status |
| CLOB | `https://clob.polymarket.com` | Order books (bid/ask + depth), price history, per-market token winner flags |

Your assumption (Gamma for markets/events, CLOB for prices/books/history) is
**correct**. **[code]**

There is also a Data API (`/v2/prices-history`, positions, etc.) that the new
unified SDK uses, but we don't need it. **[code]**

## 2. Auth

All read endpoints we need are public, no API key. Auth (L1 wallet signature /
L2 API key) is only for placing orders, cancels, balances, notifications.
**[code]** + **[docs-snippet]**

CLOB V2 (April 28, 2026) changed order signing, collateral (pUSD) and order
structs. Public read paths and the host stayed the same. Since we never place
real orders, V2 doesn't affect us. **[docs-snippet]** + **[code]**

## 3. Endpoints we'll call

### Gamma
- `GET /events` with snake_case params: `closed=false`, `active=true`,
  `order=<field>`, `ascending=false`, `tag_id=<id>`, `limit`, `offset`,
  `end_date_min`, `end_date_max`, `liquidity_min`. **[code]** for the param
  names (SDK maps camelCase to snake_case: `tagIds -> tag_id`,
  `pageSize -> limit`, `cursor -> after_cursor`).
- `GET /events/keyset` (cursor pagination via `after_cursor`, response has
  `next_cursor`). **[code]**
- `GET /events/slug/{slug}` and `GET /events/{id}`. **[code]**
- `GET /markets` (same filters), `GET /markets/keyset`. **[code]**
- `GET /public-search?q=...` (paged with `limit_per_type`, `page`). **[code]**
- `GET /tags` for category filters. **[docs-snippet]**
- Accepted values for `order` are **not confirmed**. `volume24hr`, `volume`,
  `liquidity`, `endDate`, `startDate`, `createdAt` are reported by various
  sources **[3rd-party]**. I'll verify live before relying on any of them and
  fall back to sorting our cached list server-side.

### CLOB
- `GET /book?token_id=<id>` returns **[code]**:
  ```ts
  { market, asset_id, timestamp, hash,
    bids: {price: string, size: string}[],
    asks: {price: string, size: string}[],
    min_order_size, tick_size, neg_risk, last_trade_price }
  ```
  **Gotcha:** array order is not documented and third party code reads the
  best price from the END of the array. We will compute
  `bestBid = max(bids.price)` and `bestAsk = min(asks.price)` and never trust
  array position.
- `POST /books` (batch books, body `[{token_id}]`). **[code]**
- `GET /price?token_id=&side=BUY|SELL`. **Gotcha:** per the official docs page
  snippet, `side=BUY` returns the best **bid** and `side=SELL` the best
  **ask** (i.e. the price you'd get matched against, from the book's side, not
  your side). Easy to get backwards. **We won't use `/price` for fills**;
  we use `/book` so we also get depth. **[docs-snippet]**
- `GET /prices-history?market=<token_id>&interval=...&fidelity=<minutes>` or
  `&startTs=&endTs=` (unix seconds). **[code]**
  - `market` is the **CLOB token id**, not the condition id.
  - Official client enum: `interval` in `1h, 6h, 1d, 1w, max`. Docs snippets
    also mention `1m` (one month) and `all`. The client requires either
    `interval` OR both `startTs` and `endTs`.
  - Points are `{ t: unixSeconds, p: price }`. I believe the raw response is
    wrapped as `{ "history": [...] }` (the TS client types it as a bare array);
    I'll handle both shapes.
  - Birdly mapping: 1H -> `interval=1h&fidelity=1`, 1D -> `1d&fidelity=5`,
    1W -> `1w&fidelity=30`, 1M -> `startTs/endTs` 30 days `&fidelity=180`,
    All -> `max&fidelity=720`. Fidelity values are my choice, to tune live.
- `GET /markets/{condition_id}` returns `tokens: [{token_id, outcome, price,
  winner: boolean}]`, plus `active`, `closed`, `accepting_orders`,
  `enable_order_book`. **[code]** (py client + docs snippet)

## 4. Rate limits

Official numbers (per 10 seconds, sliding window, enforced by Cloudflare).
**[docs-snippet]** from `docs.polymarket.com/api-reference/rate-limits`:

| Endpoint | Limit / 10s |
|---|---|
| Gamma general | 4,000 |
| Gamma `/events` | 500 |
| Gamma `/markets` | 300 |
| Gamma `/public-search` | 350 |
| Gamma `/tags` | 200 |
| CLOB general | 9,000 |
| CLOB `/book` | 1,500 |
| CLOB `/books`, `/prices` | 500 |
| CLOB `/prices-history` | 1,000 |

Over the limit, requests get **throttled (delayed/queued), not rejected**, so
the symptom is latency, not 429s (still handle 429 with backoff).

For 10 users this is a non issue, but we cache anyway (requirement):
market list ~60s, order book ~3-5s for display, price history ~30-60s,
plus a FRESH (uncached) book fetch at trade execution.

## 5. Multi-outcome events

An **event** contains a `markets[]` array. A multi-outcome event ("Who wins
X?") is a bundle of independent **binary** markets, one per candidate, each
with its own `conditionId` and its own YES/NO token pair. **[code]** +
**[3rd-party]**

Per market (Gamma) fields we use **[code]**:
- `id`, `conditionId`, `question`, `slug`, `groupItemTitle` (the candidate
  name inside a multi-outcome event), `endDate`, `closedTime`
- `outcomes`, `outcomePrices`, `clobTokenIds`: **raw API returns these as
  JSON-encoded strings** (e.g. `"[\"Yes\",\"No\"]"`); the SDK schemas parse
  them. Must `JSON.parse`. Index-aligned: `clobTokenIds[0]` is `outcomes[0]`.
- `active`, `closed`, `archived`, `acceptingOrders`, `enableOrderBook`
- `negRisk` (event-level `enableNegRisk`, `negRiskAugmented`): neg-risk means
  the outcomes are mutually exclusive and linked on-chain. Doesn't change our
  paper math, each market still pays $1 to its winning token.
- `bestBid`, `bestAsk`, `volume24hr`, `volume`, `liquidity` (display only;
  never used for fills).
- `umaResolutionStatus` enum: `requested | proposed | disputed | resolved |
  settled`. **[code]**

So in Birdly, "Buy YES on Candidate A" = buy token `clobTokenIds[0]` of
Candidate A's market. Each candidate shows its own Yes/No prices.

## 6. How resolution is reported

Polymarket resolves through the UMA optimistic oracle (propose, dispute window,
possibly dispute/vote). Winning tokens redeem for $1. **[docs-snippet]**

Signals available:
1. Gamma market `closed: true` and `umaResolutionStatus === "resolved"`
   (or `"settled"`). **[code]** for the enum, exact semantics of
   resolved vs settled **unverified**.
2. Gamma `outcomePrices` snaps to `["1","0"]` / `["0","1"]` after resolution.
   Right after close it can still show trading prices, so never use it alone.
   **[3rd-party]**
3. CLOB `GET /markets/{conditionId}` -> `tokens[].winner === true`. **[code]**

Birdly rule: **resolve only when the market is closed AND (CLOB `winner` flag
is set on exactly one token OR `umaResolutionStatus` is resolved/settled with
outcomePrices exactly 1/0)**. Disputed / proposed / ambiguous -> wait.

**Edge case: 50/50 or voided markets.** Some markets resolve to a split
(outcomePrices like `["0.5","0.5"]`). Plan: if closed + resolved and prices
are a valid split summing to 1, pay each share its outcome price. I could not
confirm how often this appears or exactly how the API reports it; will verify
against a known split market once I have API access.

## 7. Terms / displaying their data

- Read APIs are public and unauthenticated. **[docs-snippet]**
- I could **not** retrieve the text of polymarket.com/tos (blocked here and
  search only returned the header). So I can't tell you what it says about
  redistributing data. Public availability is not the same as a license.
- Trading on Polymarket is geoblocked for the US and other regions; the docs
  frame geoblocking around **placing orders**, and say "data and information
  is viewable globally" (3rd-party summary of their ToS). Birdly never places
  real orders. **[docs-snippet]** + **[3rd-party]**
- Our risk profile is low: private group of ~10, no money, no ads, no resale,
  no Polymarket branding. But **you should read polymarket.com/tos yourself**
  (search the page for "data", "scrap", "automated", "intellectual property").
- Trademark: not using their name/logo is the safe call. A plain text
  "Market data: Polymarket" credit is normally fine as nominative use and is
  arguably the more honest thing to do; your call (see plan questions).

## 8. Vercel free (Hobby) plan

**[docs-snippet]** from vercel.com/docs (could not load pages directly):
- **Cron jobs: once per day max on Hobby**, and it fires at some point
  **within** the scheduled hour, not on the minute. Number of crons: the
  limits table says 2 for Hobby; another Vercel-derived page says 100 per
  project on all plans as of early 2026. Either way we need only 1.
- **Function duration (Fluid compute, default on): 300s default and max on
  Hobby.** Plenty for a resolution sweep of a few dozen markets.
- Timeout returns 504 `FUNCTION_INVOCATION_TIMEOUT`.

Consequence: the daily cron is just a safety net. Lazy resolution on page
load (which you already planned) is what actually makes payouts feel prompt.
Live chart updates come from the browser polling our cached API routes, not
from cron.

## 9. Supabase free plan (relevant gotchas)

**[3rd-party]**, verify on supabase.com/pricing:
- 500 MB database, 2 active free projects, 50k MAU. Fine for us.
- **Free projects pause after 7 days with no database requests**, and must
  be manually restored. The daily Vercel cron will touch the DB, which keeps
  it awake for free.
- Reported change: projects created after 2026-05-30 need **explicit
  Postgres GRANTs** for PostgREST access (existing projects from
  2026-10-30). Our migrations will include explicit GRANTs regardless.

## 10. Current package versions (npm, 2026-10-09)

next 16.4.0, tailwindcss 4.3.3, @supabase/supabase-js 2.117.3,
@supabase/ssr 0.12.7, lightweight-charts 5.2.1, vitest 5.0.3.

## Sources

- https://github.com/Polymarket/clob-client-v2 (src/endpoints.ts, src/types/clob.ts, src/client.ts)
- https://github.com/Polymarket/py-clob-client (py_clob_client/endpoints.py, client.py)
- https://github.com/Polymarket/ts-sdk and npm `@polymarket/bindings@0.12.0`, `@polymarket/client@0.12.0`
- https://docs.polymarket.com/api-reference/rate-limits
- https://docs.polymarket.com/api-reference/markets/get-prices-history
- https://docs.polymarket.com/api-reference/market-data/get-market-price
- https://docs.polymarket.com/concepts/resolution
- https://docs.polymarket.com/api-reference/geoblock
- https://docs.polymarket.com/v2-migration
- https://polymarket.com/tos (not readable from this environment)
- https://vercel.com/docs/limits , https://vercel.com/docs/functions/limitations ,
  https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute
- Supabase limits: third party summaries (jetadmin.io, makerkit.dev); verify at https://supabase.com/pricing
