-- Birdly: database-level guard for the per-trade maximum.
--
-- SAFE TO RE-RUN. Requires 0001 first.
--
-- The app already caps every buy/sell at maxTradeUsd (src/config/site.ts).
-- This makes the database refuse any buy or sell above the limit too, so a
-- bug can never record a bigger trade. Payouts and refunds are not limited.
-- If you change maxTradeUsd in site.ts, change max_trade_usd here as well:
--   update public.app_settings set value = 5000 where key = 'max_trade_usd';

begin;

create table if not exists public.app_settings (
  key text primary key,
  value numeric not null
);
insert into public.app_settings (key, value) values ('max_trade_usd', 2000) on conflict (key) do nothing;

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant all on public.app_settings to service_role;

create or replace function public.enforce_max_trade()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max numeric;
begin
  if new.kind in ('buy', 'sell') then
    select value into v_max from public.app_settings where key = 'max_trade_usd';
    if v_max is not null and new.amount > v_max then
      raise exception 'trade_too_large: % is over the % per-trade maximum', new.amount, v_max;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_max_trade on public.trades;
create trigger enforce_max_trade before insert on public.trades
  for each row execute function public.enforce_max_trade();

revoke execute on function public.enforce_max_trade() from public, anon, authenticated;

commit;
