-- Birdly: let the admin add an outcome to a custom market, even after trading
-- has started.
--
-- SAFE TO RE-RUN: only "create or replace" and idempotent grants.
-- Requires 0001-0004 first.
--
-- How it works with the LMSR: the new outcome starts at the chance the admin
-- picks (p). Every existing outcome keeps its relative odds and is scaled by
-- (1 - p). Nobody's shares change; existing outcomes just become a bit
-- cheaper because the new option takes some probability away from them.

begin;

create or replace function public.admin_add_custom_outcome(
  p_admin_id uuid, p_id uuid, p_name text, p_start_price double precision, p_rules text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.custom_markets;
  v_name text := btrim(coalesce(p_name, ''));
  b double precision;
  qmax double precision;
  s double precision;
  q_new double precision;
  v_before double precision[];
begin
  select * into v from public.custom_markets where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v.status not in ('draft', 'open') then raise exception 'market_closed'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then raise exception 'invalid_outcome_name'; end if;
  if exists (select 1 from unnest(v.outcomes) o where lower(o) = lower(v_name)) then raise exception 'duplicate_outcome'; end if;
  if array_length(v.outcomes, 1) >= 12 then raise exception 'too_many_outcomes'; end if;
  if p_start_price is null or p_start_price < 0.01 or p_start_price > 0.5 then raise exception 'invalid_start_price'; end if;

  b := v.liquidity::double precision;
  v_before := public.lmsr_prices(v.q, b);
  -- Choose q_new so price_new = p:  exp(q_new/b) = p/(1-p) * sum_j exp(q_j/b)
  select max(x) into qmax from unnest(v.q) x;
  select sum(exp(greatest((x - qmax) / b, -700))) into s from unnest(v.q) x;
  q_new := qmax + b * ln(p_start_price / (1 - p_start_price) * s);

  update public.custom_markets
     set outcomes = outcomes || v_name,
         q = q || q_new,
         rules = case when p_rules is not null and btrim(p_rules) <> '' then btrim(p_rules) else rules end,
         updated_at = now()
   where id = v.id
   returning * into v;

  if v.status = 'open' then
    perform public.custom_market_sync(v.id);
    insert into public.custom_price_points (market_id, prices) values (v.id, public.lmsr_prices(v.q, b));
  end if;

  insert into public.admin_actions (admin_id, action, details)
  values (p_admin_id, 'add_custom_outcome', jsonb_build_object(
    'id', v.id, 'title', v.title, 'outcome', v_name, 'start_price', p_start_price,
    'prices_before', to_jsonb(v_before), 'prices_after', to_jsonb(public.lmsr_prices(v.q, b)),
    'rules_changed', p_rules is not null and btrim(p_rules) <> ''));

  return jsonb_build_object('outcomes', to_jsonb(v.outcomes), 'prices', to_jsonb(public.lmsr_prices(v.q, b)));
end;
$$;

revoke execute on function public.admin_add_custom_outcome(uuid, uuid, text, double precision, text) from public, anon, authenticated;
grant execute on function public.admin_add_custom_outcome(uuid, uuid, text, double precision, text) to service_role;

commit;
