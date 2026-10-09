# Birdly

A private, paper-money prediction market for a small group of friends and
family. Trade fake dollars against real, live odds. **No real money, ever.**

Market data comes from Polymarket's public APIs (credited in the footer).
Birdly never places real orders.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Market browsing, market page, live prices, charts (no auth) | Done |
| 2 | Auth (invite code), balances, buying/selling, portfolio, admin | Done |
| 3 | Automatic resolution and payouts | Done |
| 4 | Leaderboard, activity feed, Leahys custom markets, polish | **Ready to test** |

## Change the brand in one place

`src/config/site.ts` holds the app name, tagline, colors (accent teal, Yes
green, No red, surfaces), the footer data credit, trading limits
(`maxTradeUsd`, `maxSlippage`, `quoteTolerance`), refresh intervals, cache
lifetimes, and the home page category chips. The favicon and logo read their
colors from it too.

## Setup (Phase 2: accounts and trading)

You do these steps once. Nothing here needs the command line.

### 1. Create the Supabase project

1. Go to https://supabase.com/dashboard and create a new project (free plan).
   Pick the region **East US (North Virginia)**, which is closest to Vercel's
   default `iad1` region where your functions run.
2. Wait for it to finish provisioning.

### 2. Run the database migration

1. In the project, open **SQL Editor** then **New query**.
2. Open [`supabase/migrations/0001_core.sql`](supabase/migrations/0001_core.sql)
   in this repo, copy the **whole file**, paste it into the editor, and click **Run**.
   It should finish with "Success. No rows returned".
3. Check it worked: run `select * from public.seasons;` and you should see one
   row, "Season 1", starting balance 10000.

Run it only once. If it fails partway it rolls back completely (it's one
transaction), so you can fix the issue and run it again.

Don't create users from the Supabase dashboard. Everyone, including you,
signs up through the app with the invite code. (The database refuses accounts
without a valid display name, so dashboard-created users would fail anyway.)

### 3. Supabase dashboard settings (by hand)

Labels move around in Supabase's dashboard; if one isn't exactly where it
says, use the dashboard search.

| Where | Setting | Set to | Why |
|---|---|---|---|
| Authentication -> Sign In / Providers | **Allow new users to sign up** | **Off** | Accounts are only created by Birdly's server after it checks the invite code. |
| Authentication -> Sign In / Providers -> Email | Confirm email | Leave **on** | Birdly's server marks new accounts as confirmed itself, so this doesn't add a step. Leaving it on keeps Supabase's protections for email changes. |
| Authentication -> Sign In / Providers -> Email | Secure email change | Leave **on** | Nobody can switch their account to someone else's email (e.g. the admin's) without access to both inboxes. |
| Authentication -> URL Configuration | **Site URL** | Your production URL, e.g. `https://birdly.vercel.app` | Used in password-reset emails. |
| Authentication -> Email Templates -> **Reset Password** | Message body | See below | Points the link at Birdly. |

Reset Password template body (replace the whole body):

```html
<h2>Reset your Birdly password</h2>
<p>Tap the link below to choose a new password. It expires in an hour.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Set a new password</a></p>
<p>If you didn't ask for this, ignore this email.</p>
```

### 4. Password-reset email (read this)

Supabase's built-in email sender only delivers to members of your Supabase
organization (the people on your Supabase team), and only a couple per hour.
So **"Forgot password" emails will not reach your friends and family** until
you add a custom SMTP sender. Two options:

- **No setup:** as admin, open **Admin**, tap **Reset link** next to the
  person, and text them the link. Works today with zero email setup.
- **Self-service:** Supabase -> Authentication -> **SMTP Settings** -> enable
  custom SMTP with any provider (for example a Gmail account with an app
  password, or a transactional email service). Then raise the email rate
  limit under Authentication -> Rate Limits if needed.

### 5. Environment variables in Vercel

Vercel -> your project -> **Settings -> Environment Variables**. Add each one
for **Production** (and **Preview** too if you want preview deploys to work;
previews then use the same database).

| Name | Where to find the value | Secret? |
|---|---|---|
| `SUPABASE_URL` | Supabase -> Project Settings -> **Data API** (or the **Connect** button): Project URL, like `https://abcd1234.supabase.co` | No |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase -> Project Settings -> **API Keys**: Publishable key (`sb_publishable_...`). The legacy `anon` key also works. | No (but there's no reason to share it) |
| `SUPABASE_SECRET_KEY` | Supabase -> Project Settings -> **API Keys**: Secret key (`sb_secret_...`; create one if none exists). The legacy `service_role` key also works. | **Yes. Mark it Sensitive. It only ever lives in Vercel.** |
| `INVITE_CODE` | You make it up. Use something long-ish, like three random words. Not case-sensitive. | Yes |
| `ADMIN_EMAILS` | Your email (comma-separate to add more admins). | No |
| `SITE_URL` | **Production only:** your production URL, e.g. `https://birdly.vercel.app` (no trailing slash). Leave it unset for Preview; previews use their own branch URL automatically. | No |

None of these use the `NEXT_PUBLIC_` prefix, so none are sent to browsers.
After adding them, **redeploy** (Deployments -> ... -> Redeploy) so they take effect.

### 6. First login

1. Open your site, tap **Sign up**, enter the invite code, your display name,
   **the email you put in `ADMIN_EMAILS`**, and a password.
2. You'll see **Admin** in the top bar. Share the invite code with your group.

## Setup (Phase 3: resolution and payouts)

### 1. Run migration 0002

1. On GitHub, open `supabase/migrations/0002_resolution.sql` and click **Raw**
   (copying from the normal GitHub view can pick up stray characters).
2. Supabase -> **SQL Editor** -> **New query** -> paste the whole file -> **Run**.
3. It's safe to run more than once.

### 2. Add `CRON_SECRET` in Vercel

| Name | Value | Secret? |
|---|---|---|
| `CRON_SECRET` | A long random string (32+ characters; a password manager's generator is fine). | **Yes. Mark it Sensitive.** |

Add it for **Production** (Vercel only runs cron jobs on production
deployments). Vercel automatically sends it with each cron call; the endpoint
refuses every request if it's missing or wrong. Redeploy after adding it.

The schedule lives in `vercel.json`: once a day at 08:17 UTC (Vercel's free
plan allows one run per day and may start it anytime within that hour).

### 3. How to test it

- **Admin -> Waiting to pay out -> Check now** runs the same resolution step
  as the cron, on any deployment, previews included.
- Opening **Portfolio** also checks your own markets (at most once every 5
  minutes per market).
- To trigger the real cron endpoint by hand on production:
  `curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR-SITE/api/cron/daily`
- Vercel -> project -> **Settings -> Cron Jobs** shows the job and lets you run it.

## Setup (Phase 4: Leahys markets and reminder emails)

### 1. Run migration 0003

1. On GitHub, open `supabase/migrations/0003_custom_markets.sql` and click **Raw**.
2. Supabase -> **SQL Editor** -> **New query** -> paste the whole file -> **Run**.
3. Safe to run more than once. It also creates the four seeded **drafts**
   (Hannah's job, Beahy's leg, Beahy and Harry McLary, Liam's garage floor).
   Publish each from **Admin -> Leahys markets -> Publish**.

### 2. Run migration 0004

Adds cancel-and-refund for Leahys markets and moves the four seeded drafts'
end dates to 11:59 PM Hawaii time. Copy `supabase/migrations/0004_cancel_and_hawaii.sql`
from the **Raw** view on GitHub, paste into the SQL Editor, **Run**. Safe to
re-run. It only changes the dates of markets that are still drafts; if you
already published one, change its end date in the edit form (allowed even
after trades).

### 3. Reminder emails (Resend)

When a Leahys market passes its end date, trading closes and the daily cron
emails you once, with a link straight to its resolve page.

1. Sign up at https://resend.com **using the same email you'll put in
   `ADMIN_NOTIFY_EMAIL`**. Without a verified domain, Resend's default sender
   can only deliver to your own account email, which is all we need.
2. Resend -> **API Keys** -> **Create API key** (sending access is enough).
3. Add these in Vercel (Production):

| Name | Value | Secret? |
|---|---|---|
| `RESEND_API_KEY` | The key from step 2 (`re_...`) | **Yes. Mark it Sensitive.** |
| `ADMIN_NOTIFY_EMAIL` | The email to notify (your Resend account email) | No |
| `EMAIL_FROM` | Optional. Leave unset unless you verify a domain in Resend. | No |

Without these, everything still works: ended markets show up under
**Admin -> Waiting to pay out** with a note that emails are off.

## Leahys markets (custom markets)

- Members-only: logged-out visitors don't see the tab, the cards, or the pages
  (they get a plain 404). Drafts are visible to admins only. The tab name lives
  in `src/config/site.ts` (`customTab`).
- **Pricing: LMSR automated market maker.** Every outcome starts at equal odds
  (50/50, or 11% each with 9 outcomes); buying an outcome raises its price and
  lowers the others; prices always add up to 100%. Fills are instant, using
  the same quote -> confirm -> execute flow and safety rules as Polymarket
  trades (server-side pricing inside one locked database transaction, single-use
  60-second quotes, no overspending, no overselling, $2,000 per-trade cap).
- **Liquidity (default 1,000)** sets how much money it takes to move the odds.
  For a yes/no market at 50%:

  | Liquidity | 50% -> 60% | 50% -> 75% | 50% -> 90% | House's max subsidy (yes/no / 9 outcomes) |
  |---|---|---|---|---|
  | 500 | $112 | $347 | $805 | $347 / $1,099 |
  | **1,000 (default)** | **$223** | **$693** | **$1,609** | **$693 / $2,197** |
  | 2,500 | $558 | $1,733 | $4,024 | $1,733 / $5,493 |

  1,000 fits 5 to 10 people with $10,000 each: a $100 bet nudges a 50/50 market
  to about 55%, a confident $500 bet moves it to about 70%, and nobody can push
  it to 99% without spending close to $4,000. Lower it for livelier prices,
  raise it for steadier ones. With many outcomes each one starts cheaper, so
  the same dollars move a single outcome more (a $100 bet takes one of 9
  outcomes from 11% to about 20%).
- **Charts** record a price point on every trade.
- **Editing:** drafts (and published markets with no trades yet) are fully
  editable. Once anyone has traded, only the description and end date can change.
- **Resolving:** Admin -> Leahys markets -> **Resolve or cancel** (any time
  after publishing, so "when will X happen" markets can resolve early) or
  **Pick winner / cancel** (after the end date). Winning shares pay $1,
  everything else $0, in one transaction that can't pay twice.
- **Cancelling:** on the same page, **Cancel market and refund** shows exactly
  who gets what, then asks you to confirm. Each person gets back
  `total paid in buys - total received from sells` for that market, floored
  at $0 (someone who already sold at a profit gets nothing more, and nobody is
  ever charged). Positions are zeroed, a "refund" line appears in their trade
  history and the activity feed, and it's logged in admin actions. Running it
  twice does nothing the second time, and a cancelled market can never be
  resolved, traded or edited.
- **Time zone:** end dates are entered and shown in Hawaii time
  (`customMarketTimeZone` in `src/config/site.ts`), e.g. "Mar 31, 2027,
  11:59 PM HST", regardless of the viewer's device time zone.

## Run it locally

Requires Node 20.9+ (tested on Node 22).

```bash
npm install
cp .env.example .env.local   # optional: fill in to test accounts locally
npm run dev                  # http://localhost:3000
```

Without the Supabase variables, browsing works and account features show
"Accounts aren't set up on this server yet".

Checks:

```bash
npm test           # unit tests + the real SQL migration run in an in-memory Postgres (PGlite)
npm run typecheck
npm run lint
npm run build
```

## How accounts and trading work

- **Invite-only signup** goes through `/api/auth/signup`: rate limited per IP,
  constant-time invite-code check, then the server creates the account with
  Supabase's admin API. A database trigger creates the profile and the
  starting balance in the **same transaction**, so there's never an account
  without a balance, and the balance's primary key makes a second grant impossible.
- **The browser never talks to Supabase.** Every read and write goes through
  Birdly's server. Signed-in users' database role can read group data
  (display names, balances, trades) but can't write anything; all writes go
  through `SECURITY DEFINER` functions only the server's secret key may call.
  Emails stay in Supabase Auth and are only shown on the admin page.
- **Trades:** you see a live preview, then tap Buy/Sell to get a signed quote
  priced from a **fresh** order book. Confirm sends back only that signed,
  single-use, 60-second token. The server re-fetches the book, rejects the
  trade if the price moved more than `quoteTolerance` (2¢) against you, and
  otherwise executes at the fresh price in one database transaction (locks
  your balance row; no negative cash; can't sell shares you don't own).
- **Rate limits** (Postgres-backed): signup 10 per IP per 15 min; login 20 per IP
  and 5 per email per 15 min; reset emails 3 per email per hour; 30 trades per
  user per minute.
- **Deactivated** users are banned in Supabase Auth (can't log in) and blocked
  in the database (can't trade), and are treated as logged out immediately.
- **Sessions** persist via Supabase refresh-token cookies, refreshed by
  `src/proxy.ts`, so phones stay logged in.

## How resolution and payouts work

- **One shared step** (`src/lib/resolution/`) runs from the daily cron, from
  portfolio page loads (only that user's markets, throttled, 4-second cap),
  and from the admin **Check now** button.
- It looks at every market someone still holds that hasn't been paid, asks
  Gamma for its status, and only if Gamma says resolved asks the CLOB too.
- **Pays only when all of these hold** (rule from the live checks in
  `docs/API_NOTES.md`): Gamma says closed and `resolved`/`settled`; final
  prices exist for every outcome, are each 0, 0.5 or 1, and sum to 1; the CLOB
  is closed, agrees on every price, and flags the winner (nobody on a 50/50).
  Proposed, disputed, missing, unusual or disagreeing data means **wait**, and
  the reason shows on the admin page.
- **Payout:** each open share gets its final price ($1 / $0, or $0.50 / $0.50),
  rounded down to the cent, credited in one database transaction that also
  zeroes the position and logs a "won"/"lost"/"split" row in trade history.
- **Idempotent:** `resolve_market` locks the market row and refuses to pay a
  market twice, so the cron, a portfolio load and the admin button can all run
  at the same moment safely.
- The cron also records a daily account-value snapshot for every member, and
  emails the admin once per ended Leahys market.

## Leaderboard and activity

- **Leaderboard** ranks everyone by cash plus open positions at today's sell
  price (real best bid for Polymarket, current price for Leahys markets), with
  % return against the starting balance. Ties share a rank.
- **Activity** shows the group's recent buys, sells and payouts. Both are
  members-only. On phones, a bottom tab bar gets you to Markets, Leaders,
  Activity and Portfolio.

## How it works (market data)

- **The browser never calls Polymarket.** Pages and `/api/*` routes call
  Polymarket server-side (`src/lib/polymarket/`), with an in-memory cache plus
  CDN `Cache-Control` headers.
- **Live prices come from real CLOB order books**, not Gamma's displayed
  prices (Gamma is CDN-cached about 5 minutes).
- **If Polymarket is down,** pages show the last good data with a warning and
  the trade panel is disabled. If there's no cached data, you get a friendly
  error instead of a crash.
- **Fills walk the real order book:** buys fill at the real asks starting at
  the best ask, sells at the real bids starting at the best bid, at most
  `maxSlippage` (5¢) past the best price and `maxTradeUsd` ($2,000) per trade.
  Never midpoint, never last trade. No usable quote means no trade.
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
src/lib/trading/execute.ts    quote -> confirm -> execute rules (fresh price, tolerance, single-use)
src/lib/auth/                 signup, session, validation, admin/rate-limit guards
supabase/migrations/          SQL to paste into the Supabase SQL editor
src/lib/resolution/           payout rule (decide.ts) + shared resolution step (run.ts)
src/lib/lmsr/                 LMSR market maker math (mirrored in SQL)
src/lib/custom/               Leahys markets: loading, trading, validation, reminder emails
src/test/custom.db.test.ts    Leahys markets in PGlite: seeds, trades, editing locks, resolution, RLS
src/test/cancel.db.test.ts    cancel + refund amounts, idempotency, no resolve after cancel, 0004 re-runs
src/app/api/cron/daily/       daily cron: resolution + snapshots (needs CRON_SECRET)
src/test/db.test.ts           runs the real migrations in PGlite: atomic signup, trades, RLS
src/test/resolution.db.test.ts  payouts, 50/50, double resolution, re-running 0002
src/test/live-resolution.test.ts  opt-in live check: LIVE=1 npx vitest run src/test/live-resolution.test.ts
src/app/                      pages and /api routes
src/components/               UI (cards, chart, trade panel, logo)
```
