# Birdly

A private, paper-money prediction market for a small group of friends and
family. Trade fake dollars against real, live odds. **No real money, ever.**

Market data comes from Polymarket's public APIs (credited in the footer).
Birdly never places real orders.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Market browsing, market page, live prices, charts (no auth) | Done |
| 2 | Auth (invite code), balances, buying/selling, portfolio, admin | **Ready to test** |
| 3 | Automatic resolution and payouts | Not started |
| 4 | Leaderboard, activity feed, polish, deploy | Not started |

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
| `SITE_URL` | Your production URL, e.g. `https://birdly.vercel.app` (no trailing slash). | No |

None of these use the `NEXT_PUBLIC_` prefix, so none are sent to browsers.
After adding them, **redeploy** (Deployments -> ... -> Redeploy) so they take effect.

### 6. First login

1. Open your site, tap **Sign up**, enter the invite code, your display name,
   **the email you put in `ADMIN_EMAILS`**, and a password.
2. You'll see **Admin** in the top bar. Share the invite code with your group.

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
src/test/db.test.ts           runs the real migration in PGlite: atomic signup, trades, RLS
src/app/                      pages and /api routes
src/components/               UI (cards, chart, trade panel, logo)
```
