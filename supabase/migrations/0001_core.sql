-- Birdly core schema: profiles, balances, markets, positions, trades,
-- snapshots, rate limits, admin audit log.
--
-- Security model:
--   * The browser never talks to Supabase directly. All reads and writes go
--     through Birdly's server.
--   * Every write happens inside SECURITY DEFINER functions that only the
--     service_role (Birdly's server) may execute. Signed-in users have
--     read-only access to group data and no write access at all.
--   * Emails live only in auth.users, which is never exposed.
--
-- Run once in the Supabase SQL editor (see README). Safe to read top to bottom.

begin;

-- ---------------------------------------------------------------- seasons
-- Balances and positions are per season, so "seasons that reset balances"
-- can be added later without a schema rewrite.
create table public.seasons (
  id int primary key,
  name text not null,
  starting_balance numeric(14,2) not null check (starting_balance > 0),
  is_current boolean not null default false,
  started_at timestamptz not null default now()
);
create unique index seasons_one_current on public.seasons (is_current) where is_current;
insert into public.seasons (id, name, starting_balance, is_current) values (1, 'Season 1', 10000, true);

-- --------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (char_length(display_name) between 3 and 20)
    check (display_name ~ '^[A-Za-z0-9_.-]([A-Za-z0-9_. -]*[A-Za-z0-9_.-])?$'),
  created_at timestamptz not null default now(),
  deactivated_at timestamptz
);
-- Display names are unique ignoring case.
create unique index profiles_display_name_ci on public.profiles (lower(display_name));

-- --------------------------------------------------------------- balances
create table public.balances (
  user_id uuid not null references public.profiles (id) on delete cascade,
  season_id int not null references public.seasons (id),
  cash numeric(14,2) not null check (cash >= 0),
  created_at timestamptz not null default now(),
  -- One balance per user per season: the starting grant can only happen once.
  primary key (user_id, season_id)
);

-- ---------------------------------------------------------------- markets
-- Snapshot of each market someone has traded. `source` leaves room for
-- Kalshi or custom markets later.
create table public.markets (
  condition_id text primary key,
  source text not null default 'polymarket',
  event_slug text not null,
  event_title text not null,
  question text not null,
  label text not null,
  image text,
  outcomes jsonb not null, -- [{"name": "Yes", "token_id": "..."}, ...]
  end_date timestamptz,
  resolved_at timestamptz, -- Phase 3
  payouts jsonb,           -- Phase 3: {"<token_id>": 1.0, ...}
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------------------- positions
create table public.positions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  season_id int not null references public.seasons (id),
  token_id text not null,
  condition_id text not null references public.markets (condition_id),
  outcome_index smallint not null check (outcome_index >= 0),
  outcome_name text not null,
  shares numeric(20,4) not null check (shares >= 0),
  cost_basis numeric(14,2) not null check (cost_basis >= 0),
  realized_pnl numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id, token_id)
);
create index positions_open_by_market on public.positions (condition_id) where shares > 0;

-- ----------------------------------------------------------------- trades
create table public.trades (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  season_id int not null references public.seasons (id),
  token_id text not null,
  condition_id text not null references public.markets (condition_id),
  outcome_name text not null,
  kind text not null check (kind in ('buy', 'sell', 'payout')),
  shares numeric(20,4) not null check (shares > 0),
  price numeric(10,6) not null check (price >= 0 and price <= 1),
  amount numeric(14,2) not null check (amount >= 0), -- cash paid (buy) or received (sell/payout)
  cash_after numeric(14,2) not null,
  created_at timestamptz not null default now()
);
create index trades_recent on public.trades (created_at desc);
create index trades_by_user on public.trades (user_id, created_at desc);

-- ------------------------------------------------------ account snapshots
create table public.account_snapshots (
  user_id uuid not null references public.profiles (id) on delete cascade,
  season_id int not null references public.seasons (id),
  day date not null,
  cash numeric(14,2) not null,
  positions_value numeric(14,2) not null,
  total numeric(14,2) not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id, day)
);

-- ------------------------------------------------------------ rate limits
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits int not null
);

-- ---------------------------------------------------------- admin actions
create table public.admin_actions (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles (id) on delete set null,
  target_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================= functions

-- New auth user -> profile + starting balance, in the SAME transaction as the
-- auth.users insert. If anything fails (e.g. display name taken), the auth
-- user is rolled back too, so there's never an account without a balance.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  v_rows int;
begin
  insert into public.profiles (id, display_name) values (new.id, v_name);
  insert into public.balances (user_id, season_id, cash)
    select new.id, s.id, s.starting_balance from public.seasons s where s.is_current;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'no_current_season';
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Fixed-window rate limiter. Returns true if this hit is allowed.
create function public.rate_limit_hit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits int;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return v_hits <= p_max;
end;
$$;

-- Atomic buy/sell. Birdly's server computes shares/amount/price from a FRESH
-- real order book and calls this; no client-supplied price ever reaches it.
-- Locks the user's balance row so concurrent trades by one user serialize.
create function public.execute_trade(
  p_user_id uuid,
  p_side text,
  p_token_id text,
  p_shares numeric,
  p_amount numeric,
  p_price numeric,
  p_market jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season int;
  v_cash numeric(14,2);
  v_condition text := p_market ->> 'condition_id';
  v_outcome_index int := (p_market ->> 'outcome_index')::int;
  v_outcome_name text := p_market ->> 'outcome_name';
  v_pos public.positions;
  v_cost_removed numeric(14,2);
  v_shares_after numeric(20,4);
  v_trade_id bigint;
begin
  if p_side not in ('buy', 'sell') then
    raise exception 'invalid_side';
  end if;
  if p_shares is null or p_shares <= 0 or p_amount is null or p_amount < 0
     or p_price is null or p_price <= 0 or p_price >= 1 then
    raise exception 'invalid_amount';
  end if;
  if v_condition is null or v_outcome_index is null
     or (p_market -> 'outcomes' -> v_outcome_index ->> 'token_id') is distinct from p_token_id then
    raise exception 'invalid_market';
  end if;

  perform 1 from public.profiles where id = p_user_id and deactivated_at is null;
  if not found then
    raise exception 'account_inactive';
  end if;

  select id into v_season from public.seasons where is_current;
  select cash into v_cash from public.balances
    where user_id = p_user_id and season_id = v_season
    for update;
  if not found then
    raise exception 'no_balance';
  end if;

  insert into public.markets as m (condition_id, event_slug, event_title, question, label, image, outcomes, end_date)
  values (
    v_condition,
    p_market ->> 'event_slug',
    p_market ->> 'event_title',
    p_market ->> 'question',
    p_market ->> 'label',
    p_market ->> 'image',
    p_market -> 'outcomes',
    (p_market ->> 'end_date')::timestamptz
  )
  on conflict (condition_id) do update set
    event_slug = excluded.event_slug,
    event_title = excluded.event_title,
    question = excluded.question,
    label = excluded.label,
    image = excluded.image,
    end_date = excluded.end_date,
    updated_at = now()
  where m.resolved_at is null;

  perform 1 from public.markets where condition_id = v_condition and resolved_at is not null;
  if found then
    raise exception 'market_resolved';
  end if;

  if p_side = 'buy' then
    if v_cash < p_amount then
      raise exception 'insufficient_funds';
    end if;
    update public.balances set cash = cash - p_amount
      where user_id = p_user_id and season_id = v_season
      returning cash into v_cash;
    insert into public.positions as p (user_id, season_id, token_id, condition_id, outcome_index, outcome_name, shares, cost_basis)
    values (p_user_id, v_season, p_token_id, v_condition, v_outcome_index, v_outcome_name, p_shares, p_amount)
    on conflict (user_id, season_id, token_id) do update set
      shares = p.shares + excluded.shares,
      cost_basis = p.cost_basis + excluded.cost_basis,
      updated_at = now()
    returning shares into v_shares_after;
  else
    select * into v_pos from public.positions
      where user_id = p_user_id and season_id = v_season and token_id = p_token_id
      for update;
    if not found or v_pos.shares < p_shares then
      raise exception 'insufficient_shares';
    end if;
    -- Remove cost basis proportionally; selling everything removes all of it.
    v_cost_removed := case
      when p_shares = v_pos.shares then v_pos.cost_basis
      else round(v_pos.cost_basis * p_shares / v_pos.shares, 2)
    end;
    update public.positions set
      shares = shares - p_shares,
      cost_basis = cost_basis - v_cost_removed,
      realized_pnl = realized_pnl + (p_amount - v_cost_removed),
      updated_at = now()
    where user_id = p_user_id and season_id = v_season and token_id = p_token_id
    returning shares into v_shares_after;
    update public.balances set cash = cash + p_amount
      where user_id = p_user_id and season_id = v_season
      returning cash into v_cash;
  end if;

  insert into public.trades (user_id, season_id, token_id, condition_id, outcome_name, kind, shares, price, amount, cash_after)
  values (p_user_id, v_season, p_token_id, v_condition, v_outcome_name, p_side, p_shares, p_price, p_amount, v_cash)
  returning id into v_trade_id;

  return jsonb_build_object('trade_id', v_trade_id, 'cash', v_cash, 'shares', v_shares_after);
end;
$$;

-- Upsert today's account value snapshot. Cash comes from the database; the
-- positions value is computed by the server from live best bids.
create function public.record_snapshot(p_user_id uuid, p_positions_value numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season int;
  v_cash numeric(14,2);
begin
  select id into v_season from public.seasons where is_current;
  select cash into v_cash from public.balances where user_id = p_user_id and season_id = v_season;
  if not found then
    return;
  end if;
  insert into public.account_snapshots as s (user_id, season_id, day, cash, positions_value, total)
  values (p_user_id, v_season, (now() at time zone 'utc')::date, v_cash, round(p_positions_value, 2), v_cash + round(p_positions_value, 2))
  on conflict (user_id, season_id, day) do update set
    cash = excluded.cash,
    positions_value = excluded.positions_value,
    total = excluded.total,
    updated_at = now();
end;
$$;

-- Change display name (unique index enforces case-insensitive uniqueness).
create function public.set_display_name(p_user_id uuid, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set display_name = btrim(p_display_name) where id = p_user_id;
  if not found then
    raise exception 'no_profile';
  end if;
end;
$$;

-- Admin: reset a user to the season's starting balance and clear their open
-- positions. Trade history is kept. Audited.
create function public.admin_reset_balance(p_admin_id uuid, p_user_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season public.seasons;
  v_old numeric(14,2);
  v_cleared int;
begin
  select * into v_season from public.seasons where is_current;
  select cash into v_old from public.balances
    where user_id = p_user_id and season_id = v_season.id
    for update;
  if not found then
    raise exception 'no_balance';
  end if;
  update public.balances set cash = v_season.starting_balance
    where user_id = p_user_id and season_id = v_season.id;
  delete from public.positions where user_id = p_user_id and season_id = v_season.id;
  get diagnostics v_cleared = row_count;
  insert into public.admin_actions (admin_id, target_user_id, action, details)
  values (p_admin_id, p_user_id, 'reset_balance',
          jsonb_build_object('old_cash', v_old, 'new_cash', v_season.starting_balance, 'positions_cleared', v_cleared));
  return v_season.starting_balance;
end;
$$;

-- Admin: deactivate or reactivate. Audited. (The server also bans/unbans the
-- auth user so a deactivated account can't sign in.)
create function public.admin_set_active(p_admin_id uuid, p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
    set deactivated_at = case when p_active then null else coalesce(deactivated_at, now()) end
    where id = p_user_id;
  if not found then
    raise exception 'no_profile';
  end if;
  insert into public.admin_actions (admin_id, target_user_id, action)
  values (p_admin_id, p_user_id, case when p_active then 'reactivate' else 'deactivate' end);
end;
$$;

-- ============================================================ privileges
-- Explicit grants (Supabase stopped auto-granting new tables in 2026).

alter table public.seasons enable row level security;
alter table public.profiles enable row level security;
alter table public.balances enable row level security;
alter table public.markets enable row level security;
alter table public.positions enable row level security;
alter table public.trades enable row level security;
alter table public.account_snapshots enable row level security;
alter table public.rate_limits enable row level security;
alter table public.admin_actions enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Signed-in members can read group data (it's a shared game), never write it.
-- No email column exists in any of these tables.
grant select on public.seasons, public.profiles, public.balances, public.markets,
  public.positions, public.trades, public.account_snapshots to authenticated;
create policy "members read" on public.seasons for select to authenticated using (true);
create policy "members read" on public.profiles for select to authenticated using (true);
create policy "members read" on public.balances for select to authenticated using (true);
create policy "members read" on public.markets for select to authenticated using (true);
create policy "members read" on public.positions for select to authenticated using (true);
create policy "members read" on public.trades for select to authenticated using (true);
create policy "members read" on public.account_snapshots for select to authenticated using (true);
-- rate_limits and admin_actions: no policies, server only.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Functions are executable by PUBLIC by default in Postgres; lock them down.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
revoke execute on function public.execute_trade(uuid, text, text, numeric, numeric, numeric, jsonb) from public, anon, authenticated;
revoke execute on function public.record_snapshot(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.set_display_name(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_reset_balance(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.admin_set_active(uuid, uuid, boolean) from public, anon, authenticated;

grant execute on function public.rate_limit_hit(text, int, int) to service_role;
grant execute on function public.execute_trade(uuid, text, text, numeric, numeric, numeric, jsonb) to service_role;
grant execute on function public.record_snapshot(uuid, numeric) to service_role;
grant execute on function public.set_display_name(uuid, text) to service_role;
grant execute on function public.admin_reset_balance(uuid, uuid) to service_role;
grant execute on function public.admin_set_active(uuid, uuid, boolean) to service_role;

commit;
