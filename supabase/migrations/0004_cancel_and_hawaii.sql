-- Birdly: cancel-and-refund for custom markets, and Hawaii-time seed end dates.
--
-- SAFE TO RE-RUN: constraints are dropped/re-added, columns use
-- "if not exists", functions use "create or replace", and the seed update
-- only touches markets that are still drafts. Requires 0001-0003 first.

begin;

-- ------------------------------------------------------------ schema
alter table public.custom_markets add column if not exists cancelled_at timestamptz;
alter table public.custom_markets drop constraint if exists custom_markets_status_check;
alter table public.custom_markets add constraint custom_markets_status_check
  check (status in ('draft', 'open', 'resolved', 'cancelled'));

alter table public.markets add column if not exists cancelled boolean not null default false;

-- Refund rows in trade history: one per person, amount = cash returned.
alter table public.trades drop constraint if exists trades_kind_check;
alter table public.trades add constraint trades_kind_check check (kind in ('buy', 'sell', 'payout', 'refund'));
alter table public.trades drop constraint if exists trades_shares_check;
alter table public.trades add constraint trades_shares_check check (shares > 0 or (kind = 'refund' and shares = 0));

-- Resolved and cancelled custom markets are frozen: no edits of any kind.
create or replace function public.custom_markets_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('resolved', 'cancelled') then
    raise exception 'market_closed: % markets cannot be changed', old.status;
  end if;
  return new;
end;
$$;
drop trigger if exists custom_markets_frozen on public.custom_markets;
create trigger custom_markets_frozen before update on public.custom_markets
  for each row execute function public.custom_markets_frozen();

-- ------------------------------------------------------------ cancel
-- Cancel a published custom market and refund everyone what they paid in,
-- net of what they already got back from selling:
--   refund = max(0, sum(buy amounts) - sum(sell amounts))   per person
-- (Someone who already sold for more than they paid gets $0; nobody is
-- charged.) Positions are zeroed, trading stops for good, and the market can
-- never be resolved afterwards. Idempotent and logged in admin_actions.
create or replace function public.cancel_custom_market(p_admin_id uuid, p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.custom_markets;
  v_cid text;
  r record;
  v_cash numeric(14,2);
  v_users int := 0;
  v_total numeric(14,2) := 0;
begin
  select * into v from public.custom_markets where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v.status = 'cancelled' then
    return jsonb_build_object('already_cancelled', true, 'refunded_users', 0, 'total_refunded', 0);
  end if;
  if v.status = 'resolved' then raise exception 'already_resolved'; end if;
  if v.status <> 'open' then raise exception 'not_published'; end if;

  v_cid := 'custom:' || v.id;
  perform 1 from public.markets where condition_id = v_cid for update;

  for r in
    select user_id, season_id,
           sum(case when kind = 'buy' then amount else -amount end) as net
      from public.trades
     where condition_id = v_cid and kind in ('buy', 'sell')
     group by user_id, season_id
     order by user_id, season_id
  loop
    if r.net > 0 then
      update public.balances set cash = cash + r.net
       where user_id = r.user_id and season_id = r.season_id
       returning cash into v_cash;
      insert into public.trades (user_id, season_id, token_id, condition_id, outcome_name, kind, shares, price, amount, cash_after)
      values (r.user_id, r.season_id, v_cid || ':refund', v_cid, 'Refund (market cancelled)', 'refund', 0, 0, r.net, coalesce(v_cash, 0));
      v_users := v_users + 1;
      v_total := v_total + r.net;
    end if;
  end loop;

  update public.positions set shares = 0, cost_basis = 0, updated_at = now()
   where condition_id = v_cid and (shares > 0 or cost_basis > 0);

  update public.markets
     set resolved_at = now(), cancelled = true, payouts = null,
         resolution_note = 'Cancelled by admin. Everyone refunded.', last_checked_at = now()
   where condition_id = v_cid;

  update public.custom_markets
     set status = 'cancelled', cancelled_at = now(), resolved_at = now(), updated_at = now()
   where id = v.id;

  insert into public.admin_actions (admin_id, action, details)
  values (p_admin_id, 'cancel_custom_market',
          jsonb_build_object('id', v.id, 'title', v.title, 'refunded_users', v_users, 'total_refunded', v_total));

  return jsonb_build_object('already_cancelled', false, 'refunded_users', v_users, 'total_refunded', v_total);
end;
$$;

-- Same as 0003, plus a clear refusal for cancelled markets.
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
  if v.status = 'cancelled' then raise exception 'market_cancelled'; end if;
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

revoke execute on function public.cancel_custom_market(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.custom_markets_frozen() from public, anon, authenticated;
grant execute on function public.cancel_custom_market(uuid, uuid) to service_role;

-- ------------------------------------------------- Hawaii-time seed dates
-- 11:59 PM Hawaii time (HST, UTC-10, no daylight saving). Only drafts are
-- touched; anything already published keeps the date you gave it.
update public.custom_markets set end_at = '2027-03-31 23:59:59 Pacific/Honolulu', updated_at = now()
 where slug = 'hannahs-next-job' and status = 'draft';
update public.custom_markets set end_at = '2027-12-31 23:59:59 Pacific/Honolulu', updated_at = now()
 where slug in ('beahy-other-leg', 'beahy-harry-mclary') and status = 'draft';
update public.custom_markets set end_at = '2027-06-30 23:59:59 Pacific/Honolulu', updated_at = now()
 where slug = 'liam-garage-flake' and status = 'draft';

commit;
