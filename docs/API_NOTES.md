# Birdly API Notes

First written 2026-10-09 from Polymarket's open-source code and doc snippets;
**re-verified the same day against live responses** from
`gamma-api.polymarket.com` and `clob.polymarket.com`. Real captured responses
live in `src/lib/polymarket/__fixtures__/` and the parser tests run on them.

Tags: **[LIVE]** = confirmed by real requests on 2026-10-09.
**[code]** = from Polymarket's official client code/schemas, not exercised live.
**[docs]** = official docs (via search snippet). **[unverified]** = still a guess.

Every endpoint and parameter Birdly uses is in one file:
`src/lib/polymarket/api.ts`.

---

## What changed after live testing

| Topic | What I had inferred | What the live API actually does |
|---|---|---|
| `GET /events`, `GET /markets` (offset paging) | Usable | **Deprecated.** Responses carry `deprecation: true`, `sunset: Fri, 01 May 2026` and `warning: 299 - "use /events/keyset"`. Birdly uses `/events/keyset` and `/markets/keyset`. |
| `/price?side=` | Docs said BUY returns the bid | **Confirmed.** `side=BUY` = best **bid**, `side=SELL` = best **ask**. Birdly doesn't use it. |
| `/book` order | Unknown | Both arrays sorted **worst to best** (best price is the LAST element). Birdly sorts itself. |
| Price history 1M | Planned explicit `startTs`/`endTs` | Explicit windows **over 15 days are rejected** (`400 "'startTs' and 'endTs' interval is too long"`). `interval=1m` works and returns ~30 days. |
| History response | Probably `{history: [...]}` | Confirmed `{ "history": [{ "t": unixSeconds, "p": number }] }`. |
| Resolution signal | "Exactly one CLOB winner flag" | **Wrong for 50/50s.** On a 50/50 resolution BOTH tokens have `winner: false`, price 0.5. Must use status + final prices. |
| Gamma prices | Fresh | Gamma responses are CDN-cached (`cache-control: public, max-age=300`). Gamma `bestBid/bestAsk/outcomePrices` lagged the CLOB book by about 1¢ in testing. Display uses CLOB books. |
| Outcome names | Yes/No | Sports markets use team names (`["PARIVISION","Team Yandex"]`, `["Packers","Cowboys"]`). |
| Placeholders | Not anticipated | Multi-outcome events include placeholder markets ("Person O", "Team H", "Other") with `active: false`, sometimes priced 0.5/0.5. Must be hidden. |
| Timestamps | ISO | `closedTime` comes as Postgres-style `"2026-10-08 18:38:29+00"`. Normalized in parse.ts. |
| User-Agent | Not considered | Cloudflare returned **403** to Python's default `Python-urllib` UA. curl, `node`, `undici` and a custom UA were fine. Birdly sends `Birdly/0.1 (...)`. |
| `/books` batch | Unknown | Works with 60+ tokens. Unknown or resolved tokens are **silently dropped** and response order does **not** match request order. Key by `asset_id`. |
| `/book` after resolution | Unknown | `404 {"error":"No orderbook exists for the requested token id"}`. |

## 1. APIs and auth

| API | Base URL | Used for |
|---|---|---|
| Gamma | `https://gamma-api.polymarket.com` | Events, markets, search, tags, resolution status |
| CLOB | `https://clob.polymarket.com` | Order books, price history, per-market winner flags |

No auth on any endpoint Birdly uses. **[LIVE]** CLOB V2 (April 2026) only
changed order signing/collateral; read paths are unchanged. **[docs]**

## 2. Gamma endpoints

- `GET /events/keyset` **[LIVE]** returns `{ "$schema", "events": [...], "next_cursor": "..." }`.
  - Params verified: `closed=false`, `limit` (**capped at 100**), `order`,
    `ascending`, `tag_slug`, `exclude_tag_id`, `end_date_min` (ISO),
    `liquidity_min`, `after_cursor`.
  - Valid `order` values verified: `volume24hr`, `volume`, `endDate`,
    `startDate`, `createdAt`. An invalid one returns
    `422 {"type":"validation error","error":"order fields are not valid"}`.
  - Gotcha: `order=endDate&ascending=true` without `end_date_min` returns
    long-expired markets that were never closed (2025 end dates).
  - Gotcha: "new" and "ending soon" are flooded by 5-minute crypto
    up/down markets tagged `hide-from-new` (tag id `102169`); exclude it.
- `GET /events/slug/{slug}` **[LIVE]** returns one event; unknown slug gives 404.
- `GET /markets/keyset?condition_ids=A&condition_ids=B&closed=true` **[LIVE]** looks up
  by condition id. Repeat the parameter; a comma-separated list returns nothing.
  Without `closed=true` Gamma silently returns only OPEN markets, so the
  resolution job asks twice (closed=true, then closed=false).
- `GET /public-search?q=&limit_per_type=&events_status=active` **[LIVE]** returns
  `{ events: [...with markets], pagination: { hasMore, totalResults } }`.
- `GET /tags/slug/{slug}` **[LIVE]**. Category slugs verified to exist: `politics`,
  `sports`, `crypto`, `economy`, `tech`, `pop-culture` (label "Culture"), `world`,
  `finance`, `geopolitics`. (`culture` does not exist.)

## 3. CLOB endpoints

- `GET /book?token_id=` **[LIVE]**:
  ```json
  { "market": "<conditionId>", "asset_id": "<tokenId>", "timestamp": "1791516991331",
    "hash": "...", "bids": [{"price":"0.001","size":"2102048"}, ... best last],
    "asks": [{"price":"0.999","size":"2105445.28"}, ... best last],
    "min_order_size": "5", "tick_size": "0.001", "neg_risk": true, "last_trade_price": "0.239" }
  ```
  All numbers are strings. `timestamp` is ms. Books include huge resting
  orders at 0.001 / 0.999.
- `POST /books` body `[{"token_id": "..."}]` **[LIVE]**: see table above.
- `GET /price?token_id=&side=BUY|SELL` **[LIVE]**: example on one token: BUY → `0.239`
  (max bid 0.239), SELL → `0.248` (min ask 0.248).
- `GET /midpoint`, `GET /spread` **[LIVE]** exist; unused.
- `GET /prices-history?market=<tokenId>&interval=&fidelity=` **[LIVE]**:

  | Birdly range | Params | Live result |
  |---|---|---|
  | 1H | `interval=1h&fidelity=1` | ~61 points, 1 min apart |
  | 1D | `interval=1d&fidelity=5` | ~288 points, 5 min apart |
  | 1W | `interval=1w&fidelity=30` | ~338 points, 30 min apart |
  | 1M | `interval=1m&fidelity=180` | ~242 points, 3 h apart, ~30 days |
  | All | `interval=max&fidelity=720` | full history, 12 h apart |

  `6h` and `all` also work. `startTs` alone (no `endTs`) works for any length.
  Unknown token returns `200 {"history":[]}`. Resolved markets still return
  history.
- `GET /markets/{conditionId}` **[LIVE]**: `tokens: [{token_id, outcome, price, winner}]`,
  plus `active`, `closed`, `accepting_orders`, `enable_order_book`, `neg_risk`.

## 4. Rate limits **[docs]**

Per 10 s, Cloudflare-throttled (requests delay rather than fail):
Gamma general 4,000, `/events` 500, `/markets` 300, `/public-search` 350;
CLOB general 9,000, `/book` 1,500, `/books` 500, `/prices-history` 1,000.
Not load-tested (no reason to with 10 users). Birdly caches in memory per
instance and sets `Cache-Control: s-maxage` on its own API routes so
Vercel's CDN shares responses.

## 5. Multi-outcome events **[LIVE]**

An event has `markets[]`; each market is an independent binary market with its
own `conditionId`, `clobTokenIds` (JSON string of 2 ids), `outcomes`,
`outcomePrices` (JSON strings), and `groupItemTitle` (the candidate name).
Example: "Nobel Peace Prize Winner 2026" has 71 markets; event has
`negRisk: true`, `enableNegRisk: true`, `negRiskAugmented: true`.
Sports game events mix moneyline, spread and totals markets (one NFL game had
328 markets).

Placeholders: `active: false, closed: false`, usually no `outcomePrices`
(sometimes `["0.5","0.5"]`), `volume: "0"`, Gamma `bestBid 0 / bestAsk 1`.
Birdly shows only `active && !closed` markets.

Open markets can also carry `umaResolutionStatus: "proposed"` while still
`acceptingOrders: true` (13 seen in a 1,500-market sample). Birdly blocks
trading on any market with a non-null resolution status.

## 6. Resolution **[LIVE]**

Normal resolution (Gamma + CLOB, same market):
```
Gamma: closed: true, umaResolutionStatus: "resolved", outcomePrices: ["1","0"],
       acceptingOrders: false, automaticallyResolved: true,
       closedTime: "2026-10-08 18:38:29+00"
CLOB : closed: true, accepting_orders: false,
       tokens: [{outcome:"PARIVISION", price:1, winner:true}, {outcome:"Team Yandex", price:0, winner:false}]
```

50/50 resolution (`nfl-gb-dal-2025-09-28`, a tie; also `atp-arnaldi-cobolli-2026-06-05`):
```
Gamma: closed: true, umaResolutionStatus: "resolved", outcomePrices: ["0.5","0.5"],
       umaResolutionStatuses: "[\"proposed\"]"
CLOB : tokens: [{outcome:"Packers", price:0.5, winner:false}, {outcome:"Cowboys", price:0.5, winner:false}]
```
In a scan of the 3,000 highest-volume closed markets: 2,994 `resolved`, 6
legacy 2020-21 markets with `null` status and near-0/1 float prices
(e.g. `0.0000000206...`). Five 50/50s found. I found no market reporting
`settled` or `disputed` among closed ones, and no "voided" marker distinct
from 50/50; Polymarket's "refund" outcome appears to BE the 0.5/0.5 split.

**Birdly payout rule (Phase 3):** pay out only when Gamma says `closed` AND
`umaResolutionStatus` is `resolved` (or `settled`), AND the final prices are
each in [0,1] and sum to 1 (±0.001), AND the CLOB token prices agree. Each
share pays its final price ($1 / $0, or $0.50 / $0.50). Anything else
(proposed, disputed, missing, disagreeing) waits for a later check.

## 7. Terms / display

Unchanged from the first pass: read APIs are public; I could not read the
polymarket.com Terms of Use text. The footer shows "Market data: Polymarket"
as text only (approved). No logo or brand assets are used.

## 8. Vercel Hobby **[docs]**

Cron at most once per day (fires sometime within the hour); functions up to
300 s with Fluid compute. Not yet verified from a real deploy.

Geoblocking check: open `/api/health/polymarket` on a deploy. It probes Gamma
and CLOB from the server and reports `dataEndpointsOk` plus the Vercel region.
It also calls Polymarket's own trading-geoblock endpoint, which is
informational only (Birdly never places real orders).

## 9. Supabase free plan **[unverified, third party]**

500 MB DB; projects pause after 7 days without DB requests (the daily cron
will prevent this); reported 2026 change requiring explicit Postgres GRANTs
for PostgREST, which our migrations will include regardless.

## 10. Domains Birdly needs

Server side (Vercel functions):
- `gamma-api.polymarket.com`
- `clob.polymarket.com`
- `polymarket.com` (only the optional `/api/health/polymarket` geoblock probe)
- Phase 2+: your Supabase project, `<project-ref>.supabase.co`

Browser side:
- `polymarket-upload.s3.us-east-2.amazonaws.com` (event images, loaded as
  plain `<img>` so we don't burn Vercel's free image-optimization quota)

Build/dev (this cloud sandbox, not the deployed app):
- `registry.npmjs.org` (npm), `fonts.googleapis.com` + `fonts.gstatic.com`
  (the Geist font is downloaded at build time by `next/font`), `github.com`
  (git push), and for Phase 2 `<project-ref>.supabase.co` +
  `api.supabase.com` if migrations are run from here.

## Sources

- Live requests to gamma-api.polymarket.com and clob.polymarket.com, 2026-10-09
- https://github.com/Polymarket/clob-client-v2 , https://github.com/Polymarket/py-clob-client , npm `@polymarket/bindings@0.12.0`, `@polymarket/client@0.12.0`
- https://docs.polymarket.com/api-reference/rate-limits , /concepts/resolution , /api-reference/geoblock , /v2-migration
- https://vercel.com/docs/limits , https://vercel.com/docs/functions/limitations
