-- Birdly: custom market categories (Leahys, Rooneys, more later) and the
-- 2026 IRONMAN World Championship markets.
--
-- SAFE TO RE-RUN: create ... if not exists, create or replace, "on conflict
-- do nothing", and every move/seed checks before it acts. Requires 0001-0006.
--
-- What it does:
--   1. custom_categories table, seeded with Leahys and Rooneys (Rooneys right
--      after Leahys). Every existing custom market goes into Leahys.
--   2. Admin-only functions to create, rename and reorder categories and to
--      move a market between them. Moving changes only the category: prices,
--      positions, history and end date are untouched, and it works on any
--      market, including resolved or cancelled ones.
--   3. Moves the "FJ manual" market to Rooneys, but only if exactly one
--      market title matches.
--   4. Creates the IRONMAN drafts in Rooneys, or moves an existing market
--      with the same title there instead of creating a duplicate.
-- The last statement prints a report of what steps 3 and 4 did.

begin;

-- ============================================================ categories
create table if not exists public.custom_categories (
  id int generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 40),
  label text not null check (char_length(label) between 1 and 30),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.custom_categories (slug, label, sort_order) values
  ('leahys', 'Leahys', 10),
  ('rooneys', 'Rooneys', 20)
on conflict (slug) do nothing;

alter table public.custom_markets add column if not exists category_id int references public.custom_categories (id);
update public.custom_markets
   set category_id = (select id from public.custom_categories where slug = 'leahys')
 where category_id is null;
alter table public.custom_markets alter column category_id set not null;
create index if not exists custom_markets_by_category on public.custom_markets (category_id);

-- New markets land in the first category (Leahys) unless one is given.
create or replace function public.custom_markets_default_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category_id is null then
    select id into new.category_id from public.custom_categories order by sort_order, id limit 1;
  end if;
  return new;
end;
$$;
drop trigger if exists custom_markets_default_category on public.custom_markets;
create trigger custom_markets_default_category before insert on public.custom_markets
  for each row execute function public.custom_markets_default_category();

-- Resolved and cancelled markets stay frozen, except that an admin can still
-- move them to another category.
create or replace function public.custom_markets_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n public.custom_markets;
begin
  if old.status in ('resolved', 'cancelled') then
    n := new;
    n.category_id := old.category_id;
    if n is distinct from old then
      raise exception 'market_closed: % markets cannot be changed', old.status;
    end if;
  end if;
  return new;
end;
$$;

-- ======================================================= admin functions
create or replace function public.admin_create_custom_category(p_admin_id uuid, p_slug text, p_label text)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id int;
begin
  insert into public.custom_categories (slug, label, sort_order)
  values (p_slug, btrim(p_label), coalesce((select max(sort_order) from public.custom_categories), 0) + 10)
  returning id into v_id;
  insert into public.admin_actions (admin_id, action, details)
  values (p_admin_id, 'create_custom_category', jsonb_build_object('id', v_id, 'slug', p_slug, 'label', btrim(p_label)));
  return v_id;
end;
$$;

-- Renaming keeps the slug, so existing links keep working.
create or replace function public.admin_rename_custom_category(p_admin_id uuid, p_id int, p_label text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  select label into v_old from public.custom_categories where id = p_id for update;
  if not found then raise exception 'category_not_found'; end if;
  update public.custom_categories set label = btrim(p_label) where id = p_id;
  insert into public.admin_actions (admin_id, action, details)
  values (p_admin_id, 'rename_custom_category', jsonb_build_object('id', p_id, 'from', v_old, 'to', btrim(p_label)));
end;
$$;

-- p_ids must list every category exactly once, in the new order.
create or replace function public.admin_reorder_custom_categories(p_admin_id uuid, p_ids int[])
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(array_length(p_ids, 1), 0) <> (select count(*) from public.custom_categories)
     or (select count(distinct x) from unnest(p_ids) x) <> array_length(p_ids, 1)
     or exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.custom_categories c where c.id = x)) then
    raise exception 'invalid_order';
  end if;
  update public.custom_categories c set sort_order = t.ord * 10
    from unnest(p_ids) with ordinality t(id, ord)
   where c.id = t.id;
  insert into public.admin_actions (admin_id, action, details)
  values (p_admin_id, 'reorder_custom_categories', jsonb_build_object('order', to_jsonb(p_ids)));
end;
$$;

-- Moves a market to another category. Touches nothing but category_id.
create or replace function public.admin_move_custom_market(p_admin_id uuid, p_market_id uuid, p_category_id int)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_title text;
  v_from int;
begin
  if not exists (select 1 from public.custom_categories where id = p_category_id) then
    raise exception 'category_not_found';
  end if;
  select title, category_id into v_title, v_from from public.custom_markets where id = p_market_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_from = p_category_id then return; end if;
  update public.custom_markets set category_id = p_category_id where id = p_market_id;
  insert into public.admin_actions (admin_id, action, details)
  values (p_admin_id, 'move_custom_market', jsonb_build_object('id', p_market_id, 'title', v_title, 'from', v_from, 'to', p_category_id));
end;
$$;

-- ============================================================ privileges
alter table public.custom_categories enable row level security;
revoke all on public.custom_categories from anon, authenticated;
grant select on public.custom_categories to authenticated;
grant all on public.custom_categories to service_role;
grant all on all sequences in schema public to service_role;
drop policy if exists "members read" on public.custom_categories;
create policy "members read" on public.custom_categories for select to authenticated using (true);

revoke execute on function public.custom_markets_default_category() from public, anon, authenticated;
revoke execute on function public.admin_create_custom_category(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.admin_rename_custom_category(uuid, int, text) from public, anon, authenticated;
revoke execute on function public.admin_reorder_custom_categories(uuid, int[]) from public, anon, authenticated;
revoke execute on function public.admin_move_custom_market(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.admin_create_custom_category(uuid, text, text) to service_role;
grant execute on function public.admin_rename_custom_category(uuid, int, text) to service_role;
grant execute on function public.admin_reorder_custom_categories(uuid, int[]) to service_role;
grant execute on function public.admin_move_custom_market(uuid, uuid, int) to service_role;

-- ============================================== report of steps 3 and 4
create temp table if not exists birdly_0007_report (n serial, step text, result text);
truncate birdly_0007_report;

-- =========================================== step 3: the FJ manual market
do $$
declare
  v_rooneys int := (select id from public.custom_categories where slug = 'rooneys');
  v_n int;
  v_title text;
begin
  select count(*), min(title) into v_n, v_title
    from public.custom_markets where title ilike '%FJ%' and title ilike '%manual%';
  if v_n = 1 then
    update public.custom_markets set category_id = v_rooneys
     where title ilike '%FJ%' and title ilike '%manual%';
    insert into birdly_0007_report (step, result) values ('FJ manual market', 'In Rooneys: ' || v_title);
  else
    insert into birdly_0007_report (step, result)
    select 'FJ manual market',
           format('NOT moved: %s titles match "FJ" + "manual". All custom market titles: %s', v_n,
                  coalesce(string_agg(title, ' | ' order by created_at), '(none)'))
      from public.custom_markets;
  end if;
end;
$$;

-- ===================================== step 4: 2026 IRONMAN World Championship
-- Drafts in Rooneys. Trading closes 12:55 PM Hawaii time on race day, about
-- 60 minutes before the earliest expected men's finish (a course-record pace
-- of ~7:35 from the 6:20 AM start). An existing market with the same title
-- (any category) is moved to Rooneys instead of being duplicated.
do $$
declare
  v_rooneys int := (select id from public.custom_categories where slug = 'rooneys');
  v_end timestamptz := '2026-10-10 12:55:00 Pacific/Honolulu';
  v_rules_common text := 'Resolves from the official IRONMAN results for the professional race. If a result changes because of a disqualification before the admin resolves this market, the official result at the time of resolving counts. If no official result is declared (for example the race is cancelled), the market is cancelled and everyone is refunded.';
  v_note text := E'\n\nAt creation (checked 9:11 AM Hawaii time, Sat Oct 10, 2026, from Triathlete''s live blog, latest entry 8:51 AM): men on the bike climbing to Hawi with Jonas Schomburg (DEU) leading, Greg Barnaby (ITA) 2nd at 1:36 and Matthew Marquardt (USA) 3rd. Marten Van Riel (BEL) was sick and losing time, and Patrick Lange (DEU) had stopped at the roadside. Gustav Iden, Kristian Blummenfelt and Sam Laidlow were in the chasing field. Women about 35 miles into the bike, Taylor Knibb (USA) and Lucy Charles-Barclay (GBR) trading the lead; at 7:31 AM Kat Matthews was 3:44 back, defending champion Solveig Løvseth 4:42 back and Laura Philipp 8:59 back. Daisy Davies (GBR) had withdrawn. Did not start: Casper Stornes, Arthur Horseau, Rasmus Svenningsson (men); Chelsea Sodaro, Nina Derron, Daniela Bleymehl (women).';
  s record;
  v_existing text;
  v_inserted int;
begin
  for s in
    select * from (values
      (1, 'ironman-2026-mens-winner',
       'Who wins the men''s 2026 IRONMAN World Championship?',
       'The men''s pro race at the 2026 IRONMAN World Championship in Kona, Hawaii, started 6:20 AM Hawaii time on October 10, 2026.',
       'Resolves to the official winner of the men''s professional race. "Someone else" if the winner is not listed. ',
       array['Kristian Blummenfelt', 'Sam Laidlow', 'Gustav Iden', 'Jonas Schomburg', 'Magnus Ditlev', 'Rudy von Berg', 'Someone else']),
      (2, 'ironman-2026-womens-winner',
       'Who wins the women''s 2026 IRONMAN World Championship?',
       'The women''s pro race at the 2026 IRONMAN World Championship in Kona, Hawaii, started 6:30 AM Hawaii time on October 10, 2026.',
       'Resolves to the official winner of the women''s professional race. "Someone else" if the winner is not listed. ',
       array['Taylor Knibb', 'Lucy Charles-Barclay', 'Solveig Løvseth', 'Kat Matthews', 'Laura Philipp', 'Julie Derron', 'Someone else']),
      (3, 'ironman-2026-norwegian-mens-winner',
       'Will a Norwegian win the men''s 2026 IRONMAN World Championship?',
       'Norway has Kristian Blummenfelt and Gustav Iden (both past world champions), Marius Bjerkeset and Jon Saeveras Breivold on the start line. Defending champion Casper Stornes (NOR) did not start.',
       'Yes if the official winner of the men''s professional race represents Norway (NOR). No otherwise. ',
       array['Yes', 'No']),
      (4, 'ironman-2026-mens-course-record',
       'Will the men''s winner break the Kona course record of 7:35:53?',
       'The men''s Kona course record is 7:35:53, set by Patrick Lange in 2024, the last men''s world championship held in Kona (the 2025 men''s race was in Nice). Race morning was wet and humid.',
       'Yes if the official finishing time of the men''s professional winner is faster than 7:35:53. A time of exactly 7:35:53 or slower is No. ',
       array['Yes', 'No']),
      (5, 'ironman-2026-knibb-podium',
       'Will Taylor Knibb finish on the women''s podium at the 2026 IRONMAN World Championship?',
       'Taylor Knibb (USA) did not finish in Kona last year, dropping out about two miles from the line.',
       'Yes if Taylor Knibb finishes 1st, 2nd or 3rd in the official results of the women''s professional race. No if she finishes 4th or lower or does not finish. ',
       array['Yes', 'No'])
    ) t(ord, slug, title, description, rules, outcomes)
    order by ord
  loop
    select title into v_existing from public.custom_markets
     where lower(btrim(title)) = lower(btrim(s.title)) order by created_at limit 1;
    if v_existing is not null then
      update public.custom_markets set category_id = v_rooneys
       where lower(btrim(title)) = lower(btrim(s.title));
      insert into birdly_0007_report (step, result) values ('IRONMAN ' || s.ord, 'Already existed, now in Rooneys: ' || v_existing);
    else
      insert into public.custom_markets (slug, title, description, rules, outcomes, q, liquidity, end_at, category_id)
      values (s.slug, s.title, s.description || v_note, s.rules || v_rules_common, s.outcomes,
              array_fill(0::double precision, array[array_length(s.outcomes, 1)]), 1000, v_end, v_rooneys)
      on conflict (slug) do nothing;
      get diagnostics v_inserted = row_count;
      insert into birdly_0007_report (step, result)
      values ('IRONMAN ' || s.ord, case when v_inserted = 1 then 'Created draft in Rooneys: ' || s.title
                                        else 'SKIPPED, URL name already used by another market: ' || s.slug end);
    end if;
  end loop;

  -- Flag look-alikes that didn't match a title exactly, so nothing is duplicated by accident.
  insert into birdly_0007_report (step, result)
  select 'Check for duplicates', 'Other market mentioning IRONMAN/Kona (left where it is): ' || title
    from public.custom_markets
   where (title ilike '%ironman%' or title ilike '%kona%')
     and slug not like 'ironman-2026-%'
     and category_id <> v_rooneys;
end;
$$;

commit;

select step, result from birdly_0007_report order by n;
