-- Birdly Phase 3: automatic resolution and payouts.
--
-- SAFE TO RE-RUN: every statement is idempotent (add column if not exists,
-- create or replace, idempotent grants). Requires 0001_core.sql first.

begin;

-- What the last resolution check found, for the admin "waiting" view.
alter table public.markets add column if not exists last_checked_at timestamptz;
alter table public.markets add column if not exists resolution_note text;
alter table public.markets add column if not exists polymarket_closed boolean not null default false;

create index if not exists markets_unresolved on public.markets (last_checked_at) where resolved_at is null;

-- Record the outcome of a check that did NOT pay out.
create or replace function public.note_resolution_check(p_condition_id text, p_note text, p_closed boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.markets
     set last_checked_at = now(), resolution_note = left(p_note, 300), polymarket_closed = p_closed
   where condition_id = p_condition_id and resolved_at is null;
$$;

-- Pay out a resolved market. Idempotent: the market row is locked and a
-- market that already has resolved_at set is never paid twice.
-- p_payouts: {"<token_id>": 1, "<token_id>": 0} (or 0.5 / 0.5). Every token in
-- the market's outcomes must be present, values in [0, 1], summing to 1.
-- Each open position is paid shares * payout, rounded DOWN to the cent.
create or replace function public.resolve_market(p_condition_id text, p_payouts jsonb, p_note text default 'Resolved.')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_market public.markets;
  v_token text;
  v_sum numeric := 0;
  v_count int := 0;
  v_pos record;
  v_pay numeric;
  v_amount numeric(14,2);
  v_cash numeric(14,2);
  v_paid int := 0;
  v_total numeric(14,2) := 0;
begin
  select * into v_market from public.markets where condition_id = p_condition_id for update;
  if not found then
    raise exception 'unknown_market';
  end if;
  if v_market.resolved_at is not null then
    return jsonb_build_object('already_resolved', true, 'paid_positions', 0, 'total_paid', 0);
  end if;

  -- Validate the payout map against the stored outcomes.
  if jsonb_typeof(p_payouts) <> 'object' then
    raise exception 'invalid_payouts';
  end if;
  for v_token in select o ->> 'token_id' from jsonb_array_elements(v_market.outcomes) o loop
    if not (p_payouts ? v_token) then
      raise exception 'invalid_payouts: missing %', v_token;
    end if;
    v_pay := (p_payouts ->> v_token)::numeric;
    if v_pay < 0 or v_pay > 1 then
      raise exception 'invalid_payouts: out of range';
    end if;
    v_sum := v_sum + v_pay;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 or (select count(*) from jsonb_object_keys(p_payouts)) <> v_count then
    raise exception 'invalid_payouts: token mismatch';
  end if;
  if abs(v_sum - 1) > 0.001 then
    raise exception 'invalid_payouts: sum %', v_sum;
  end if;

  -- Pay every open position in this market (any season), in a stable order.
  for v_pos in
    select * from public.positions
     where condition_id = p_condition_id and shares > 0
     order by user_id, season_id, token_id
     for update
  loop
    v_pay := (p_payouts ->> v_pos.token_id)::numeric;
    v_amount := floor(v_pos.shares * v_pay * 100) / 100;

    update public.balances set cash = cash + v_amount
     where user_id = v_pos.user_id and season_id = v_pos.season_id
     returning cash into v_cash;

    update public.positions
       set realized_pnl = realized_pnl + (v_amount - cost_basis),
           shares = 0,
           cost_basis = 0,
           updated_at = now()
     where user_id = v_pos.user_id and season_id = v_pos.season_id and token_id = v_pos.token_id;

    insert into public.trades (user_id, season_id, token_id, condition_id, outcome_name, kind, shares, price, amount, cash_after)
    values (v_pos.user_id, v_pos.season_id, v_pos.token_id, p_condition_id, v_pos.outcome_name, 'payout',
            v_pos.shares, v_pay, v_amount, coalesce(v_cash, 0));

    v_paid := v_paid + 1;
    v_total := v_total + v_amount;
  end loop;

  update public.markets
     set resolved_at = now(),
         payouts = p_payouts,
         polymarket_closed = true,
         last_checked_at = now(),
         resolution_note = left(p_note, 300)
   where condition_id = p_condition_id;

  return jsonb_build_object('already_resolved', false, 'paid_positions', v_paid, 'total_paid', v_total);
end;
$$;

revoke execute on function public.note_resolution_check(text, text, boolean) from public, anon, authenticated;
revoke execute on function public.resolve_market(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.note_resolution_check(text, text, boolean) to service_role;
grant execute on function public.resolve_market(text, jsonb, text) to service_role;

commit;
