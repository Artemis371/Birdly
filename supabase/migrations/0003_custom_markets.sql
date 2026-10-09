-- Birdly Phase 4: custom ("Leahys") markets priced by an LMSR market maker.
--
-- SAFE TO RE-RUN: create ... if not exists, create or replace, idempotent
-- grants/policies, and seed rows inserted with "on conflict do nothing".
-- Requires 0001 and 0002 first.
--
-- Design: each published custom market gets a row in public.markets with
-- source = 'custom', condition_id = 'custom:<id>' and token ids
-- 'custom:<id>:<outcome index>'. That way balances, positions, trades,
-- holders, portfolio and payouts all reuse the existing, tested machinery
-- (execute_trade and resolve_market).

begin;

create table if not exists public.custom_markets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title text not null check (char_length(title) between 3 and 140),
  description text not null default '' check (char_length(description) <= 4000),
  rules text not null default '' check (char_length(rules) <= 4000),
  outcomes text[] not null check (array_length(outcomes, 1) between 2 and 12),
  q double precision[] not null, -- LMSR shares outstanding per outcome
  liquidity numeric(12,2) not null default 1000 check (liquidity between 50 and 100000),
  end_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'resolved')),
  winning_index int,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  resolved_at timestamptz,
  notify_sent_at timestamptz, -- end-date email to the admin (sent once)
  check (array_length(q, 1) = array_length(outcomes, 1))
);

create table if not exists public.custom_price_points (
  id bigint generated always as identity primary key,
  market_id uuid not null references public.custom_markets (id) on delete cascade,
  at timestamptz not null default now(),
  prices double precision[] not null
);
create index if not exists custom_price_points_by_market on public.custom_price_points (market_id, at);

-- ------------------------------------------------------------- LMSR math
create or replace function public.lmsr_cost(p_q double precision[], p_b double precision)
returns double precision
language sql immutable
set search_path = ''
as $$
  with m as (select max(x / p_b) as mx from unnest(p_q) x)
  select p_b * (m.mx + ln(sum(exp(greatest(x / p_b - m.mx, -700))))) from unnest(p_q) x, m group by m.mx;
$$;

create or replace function public.lmsr_prices(p_q double precision[], p_b double precision)
returns double precision[]
language sql immutable
set search_path = ''
as $$
  with m as (select max(x / p_b) as mx from unnest(p_q) x),
       e as (select ord, exp(greatest(x / p_b - m.mx, -700)) as v from unnest(p_q) with ordinality t(x, ord), m)
  select array_agg(v / (select sum(v) from e) order by ord) from e;
$$;

-- Keep the public.markets row in step with a published custom market.
create or replace function public.custom_market_sync(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.custom_markets;
begin
  select * into v from public.custom_markets where id = p_id;
  insert into public.markets as m (condition_id, source, event_slug, event_title, question, label, outcomes, end_date)
  values (
    'custom:' || v.id, 'custom', v.slug, v.title, v.title, v.title,
    (select jsonb_agg(jsonb_build_object('name', o, 'token_id', 'custom:' || v.id || ':' || (i - 1)) order by i)
       from unnest(v.outcomes) with ordinality t(o, i)),
    v.end_at
  )
  on conflict (condition_id) do update set
    event_slug = excluded.event_slug, event_title = excluded.event_title, question = excluded.question,
    label = excluded.label, outcomes = excluded.outcomes, end_date = excluded.end_date, updated_at = now()
  where m.resolved_at is null;
end;
$$;

-- Create or edit a custom market (admin). Rules:
--   * drafts, and published markets with no trades yet: everything editable
--   * once a market has trades: only description and end date can change
--   * resolved markets: nothing changes
-- p_publish = true publishes a draft (opens trading at equal odds).
create or replace function public.admin_save_custom_market(
  p_admin_id uuid, p_id uuid, p_slug text, p_title text, p_description text, p_rules text,
  p_outcomes text[], p_end_at timestamptz, p_liquidity numeric, p_publish boolean
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.custom_markets;
  v_has_trades boolean := false;
  v_id uuid;
begin
  if p_id is null then
    insert into public.custom_markets (slug, title, description, rules, outcomes, q, liquidity, end_at, created_by)
    values (p_slug, p_title, coalesce(p_description, ''), coalesce(p_rules, ''), p_outcomes,
            array_fill(0::double precision, array[array_length(p_outcomes, 1)]), p_liquidity, p_end_at, p_admin_id)
    returning * into v;
  else
    select * into v from public.custom_markets where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    if v.status = 'resolved' then raise exception 'already_resolved'; end if;
    v_has_trades := exists (select 1 from public.trades where condition_id = 'custom:' || v.id);
    if v_has_trades then
      if p_slug <> v.slug or p_title <> v.title or coalesce(p_rules, '') <> v.rules
         or p_outcomes <> v.outcomes or p_liquidity <> v.liquidity then
        raise exception 'locked_after_trades';
      end if;
      update public.custom_markets
         set description = coalesce(p_description, ''), end_at = p_end_at, updated_at = now(),
             notify_sent_at = case when p_end_at <> v.end_at then null else notify_sent_at end
       where id = v.id returning * into v;
    else
      update public.custom_markets
         set slug = p_slug, title = p_title, description = coalesce(p_description, ''), rules = coalesce(p_rules, ''),
             outcomes = p_outcomes, liquidity = p_liquidity, end_at = p_end_at, updated_at = now(),
             q = case when p_outcomes <> v.outcomes then array_fill(0::double precision, array[array_length(p_outcomes, 1)]) else q end,
             notify_sent_at = case when p_end_at <> v.end_at then null else notify_sent_at end
       where id = v.id returning * into v;
    end if;
  end if;

  if p_publish and v.status = 'draft' then
    update public.custom_markets set status = 'open', published_at = now() where id = v.id returning * into v;
    insert into public.admin_actions (admin_id, action, details) values (p_admin_id, 'publish_custom_market', jsonb_build_object('id', v.id, 'title', v.title));
  end if;

  if v.status = 'open' then
    perform public.custom_market_sync(v.id);
    -- No trades yet: the chart history is just the starting odds, so reset it.
    if not v_has_trades then
      delete from public.custom_price_points where market_id = v.id;
      insert into public.custom_price_points (market_id, prices) values (v.id, public.lmsr_prices(v.q, v.liquidity::double precision));
    end if;
  end if;
  v_id := v.id;
  return v_id;
end;
$$;

create or replace function public.admin_delete_custom_draft(p_admin_id uuid, p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.custom_markets where id = p_id and status = 'draft';
  if not found then raise exception 'not_a_draft'; end if;
  insert into public.admin_actions (admin_id, action, details) values (p_admin_id, 'delete_custom_draft', jsonb_build_object('id', p_id));
end;
$$;

-- Atomic LMSR trade. Prices come from the locked market state inside this
-- transaction. The server passes the signed quote's average price; if the
-- fresh fill is worse by more than p_tolerance, nothing happens ('price_moved').
-- Balance/position/trade bookkeeping reuses execute_trade (same safety rules).
create or replace function public.execute_custom_trade(
  p_user_id uuid, p_market_id uuid, p_index int, p_side text, p_amount numeric,
  p_ref_avg numeric, p_tolerance numeric, p_max_trade numeric
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.custom_markets;
  b double precision;
  q2 double precision[];
  c0 double precision;
  budget double precision;
  target double precision;
  others double precision;
  d double precision;
  lo double precision;
  hi double precision;
  mid double precision;
  v_total numeric(14,2);
  v_avg numeric;
  v_market jsonb;
  v_result jsonb;
  k int;
begin
  select * into v from public.custom_markets where id = p_market_id for update;
  if not found or v.status = 'draft' then raise exception 'not_found'; end if;
  if v.status <> 'open' then raise exception 'market_resolved'; end if;
  if now() >= v.end_at then raise exception 'market_ended'; end if;
  if p_index < 0 or p_index >= array_length(v.outcomes, 1) then raise exception 'invalid_market'; end if;
  if p_side not in ('buy', 'sell') or p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;

  b := v.liquidity::double precision;
  c0 := public.lmsr_cost(v.q, b);

  if p_side = 'buy' then
    budget := least(p_amount, p_max_trade)::double precision;
    target := (c0 + budget) / b;
    select coalesce(sum(exp(greatest(x / b - target, -700))), 0) into others
      from unnest(v.q) with ordinality t(x, ord) where ord <> p_index + 1;
    d := b * (target + ln(1 - others)) - v.q[p_index + 1];
    d := floor(d * 10000 + 1e-6) / 10000;
    for k in 1..50 loop
      if d <= 0 then raise exception 'amount_too_small'; end if;
      q2 := v.q; q2[p_index + 1] := q2[p_index + 1] + d;
      v_total := ceil((public.lmsr_cost(q2, b) - c0) * 100 - 1e-9) / 100;
      exit when v_total <= budget + 1e-9;
      d := d - 0.001;
    end loop;
  else
    -- Check ownership before any math (execute_trade re-checks under lock too).
    if coalesce((select shares from public.positions
                  where user_id = p_user_id and token_id = 'custom:' || v.id || ':' || p_index
                    and season_id = (select id from public.seasons where is_current)), 0) < p_amount then
      raise exception 'insufficient_shares';
    end if;
    d := floor(p_amount::double precision * 10000 + 1e-6) / 10000;
    q2 := v.q; q2[p_index + 1] := q2[p_index + 1] - d;
    if c0 - public.lmsr_cost(q2, b) > p_max_trade then
      lo := 0; hi := d;
      for k in 1..60 loop
        mid := (lo + hi) / 2;
        q2 := v.q; q2[p_index + 1] := q2[p_index + 1] - mid;
        if c0 - public.lmsr_cost(q2, b) > p_max_trade then hi := mid; else lo := mid; end if;
      end loop;
      d := floor(lo * 10000 + 1e-6) / 10000;
      q2 := v.q; q2[p_index + 1] := q2[p_index + 1] - d;
    end if;
    v_total := floor((c0 - public.lmsr_cost(q2, b)) * 100 + 1e-9) / 100;
  end if;

  if d <= 0 or v_total <= 0 then raise exception 'amount_too_small'; end if;
  v_avg := v_total / d::numeric;
  if p_ref_avg is not null then
    if (p_side = 'buy' and v_avg > p_ref_avg + p_tolerance + 1e-9)
       or (p_side = 'sell' and v_avg < p_ref_avg - p_tolerance - 1e-9) then
      raise exception 'price_moved';
    end if;
  end if;

  select jsonb_build_object(
           'condition_id', m.condition_id, 'event_slug', m.event_slug, 'event_title', m.event_title,
           'question', m.question, 'label', m.label, 'image', m.image, 'outcomes', m.outcomes,
           'end_date', m.end_date, 'outcome_index', p_index, 'outcome_name', v.outcomes[p_index + 1])
    into v_market
    from public.markets m where m.condition_id = 'custom:' || v.id;
  if v_market is null then raise exception 'invalid_market'; end if;

  v_result := public.execute_trade(p_user_id, p_side, 'custom:' || v.id || ':' || p_index,
                                   d::numeric, v_total, round(v_avg, 6), v_market);

  update public.custom_markets set q = q2, updated_at = now() where id = v.id;
  insert into public.custom_price_points (market_id, prices) values (v.id, public.lmsr_prices(q2, b));

  return v_result || jsonb_build_object('filled_shares', d, 'total', v_total, 'avg', v_avg, 'prices', to_jsonb(public.lmsr_prices(q2, b)));
end;
$$;

-- Admin resolves a custom market (any time after publishing, so "when will X
-- happen" markets can resolve early). Winning shares pay $1, others $0, via
-- resolve_market. Idempotent.
create or replace function public.resolve_custom_market(p_admin_id uuid, p_id uuid, p_winner int)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.custom_markets;
  v_payouts jsonb;
  v_result jsonb;
begin
  select * into v from public.custom_markets where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v.status = 'resolved' then
    return jsonb_build_object('already_resolved', true, 'paid_positions', 0, 'total_paid', 0);
  end if;
  if v.status <> 'open' then raise exception 'not_published'; end if;
  if p_winner < 0 or p_winner >= array_length(v.outcomes, 1) then raise exception 'invalid_winner'; end if;

  select jsonb_object_agg('custom:' || v.id || ':' || (i - 1), case when i - 1 = p_winner then 1 else 0 end)
    into v_payouts
    from generate_series(1, array_length(v.outcomes, 1)) i;

  perform public.custom_market_sync(v.id);
  v_result := public.resolve_market('custom:' || v.id, v_payouts, 'Resolved by admin: ' || v.outcomes[p_winner + 1]);

  update public.custom_markets
     set status = 'resolved', winning_index = p_winner, resolved_at = now(), updated_at = now()
   where id = v.id;
  insert into public.admin_actions (admin_id, action, details)
  values (p_admin_id, 'resolve_custom_market', jsonb_build_object('id', v.id, 'title', v.title, 'winner', v.outcomes[p_winner + 1]) || v_result);
  return v_result;
end;
$$;

-- ================================================================ seeds
-- Four drafts to review and publish. End dates are 11:59 PM Hawaii time.
insert into public.custom_markets (slug, title, description, rules, outcomes, q, liquidity, end_at) values
(
  'hannahs-next-job',
  'What will Hannah''s next job be?',
  'Hannah is between jobs. Where does she land next?',
  'Resolves to the first new job Hannah actually starts (first shift worked) before the end date. "Something else" if it isn''t on the list. "Still between jobs" if she hasn''t started one by the end date.',
  array['Bakery', 'Librarian', 'Florist', 'Barista', 'Dog walker', 'Yoga instructor', 'Candle shop', 'Something else', 'Still between jobs'],
  array_fill(0::double precision, array[9]), 1000, '2027-03-31 23:59:59 Pacific/Honolulu'
),
(
  'beahy-other-leg',
  'When will Beahy fall over and break her other leg?',
  'One leg down. Place your bets on the other one.',
  'Resolves to the range containing the date of a confirmed broken leg (the other one). Sprains and bruises do not count.',
  array['Before Jan 1, 2027', 'Jan to Jun 2027', 'Jul to Dec 2027', 'Not by end of 2027'],
  array_fill(0::double precision, array[4]), 1000, '2027-12-31 23:59:59 Pacific/Honolulu'
),
(
  'beahy-harry-mclary',
  'When will Beahy kick Harry McLary to the curb?',
  'How long does Harry McLary last?',
  'Resolves to the range containing the date it becomes official, confirmed by Beahy.',
  array['Before Jan 1, 2027', 'Jan to Jun 2027', 'Jul to Dec 2027', 'Not by end of 2027'],
  array_fill(0::double precision, array[4]), 1000, '2027-12-31 23:59:59 Pacific/Honolulu'
),
(
  'liam-garage-flake',
  'Will Liam add more flake to his garage floor?',
  'The garage floor saga continues.',
  'Yes if Liam applies any additional flake to the garage floor before the end date, confirmed by photo. Touch-ups count.',
  array['Yes', 'No'],
  array_fill(0::double precision, array[2]), 1000, '2027-06-30 23:59:59 Pacific/Honolulu'
)
on conflict (slug) do nothing;

-- ============================================================ privileges
alter table public.custom_markets enable row level security;
alter table public.custom_price_points enable row level security;

revoke all on public.custom_markets, public.custom_price_points from anon, authenticated;
grant select on public.custom_markets, public.custom_price_points to authenticated;
grant all on public.custom_markets, public.custom_price_points to service_role;
grant all on all sequences in schema public to service_role;

-- Members see published markets only; drafts stay admin-only.
drop policy if exists "members read published" on public.custom_markets;
create policy "members read published" on public.custom_markets for select to authenticated using (status <> 'draft');
drop policy if exists "members read published" on public.custom_price_points;
create policy "members read published" on public.custom_price_points for select to authenticated
  using (exists (select 1 from public.custom_markets m where m.id = market_id and m.status <> 'draft'));

revoke execute on function public.lmsr_cost(double precision[], double precision) from public, anon, authenticated;
revoke execute on function public.lmsr_prices(double precision[], double precision) from public, anon, authenticated;
revoke execute on function public.custom_market_sync(uuid) from public, anon, authenticated;
revoke execute on function public.admin_save_custom_market(uuid, uuid, text, text, text, text, text[], timestamptz, numeric, boolean) from public, anon, authenticated;
revoke execute on function public.admin_delete_custom_draft(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.execute_custom_trade(uuid, uuid, int, text, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.resolve_custom_market(uuid, uuid, int) from public, anon, authenticated;

grant execute on function public.lmsr_cost(double precision[], double precision) to service_role;
grant execute on function public.lmsr_prices(double precision[], double precision) to service_role;
grant execute on function public.custom_market_sync(uuid) to service_role;
grant execute on function public.admin_save_custom_market(uuid, uuid, text, text, text, text, text[], timestamptz, numeric, boolean) to service_role;
grant execute on function public.admin_delete_custom_draft(uuid, uuid) to service_role;
grant execute on function public.execute_custom_trade(uuid, uuid, int, text, numeric, numeric, numeric, numeric) to service_role;
grant execute on function public.resolve_custom_market(uuid, uuid, int) to service_role;

commit;
