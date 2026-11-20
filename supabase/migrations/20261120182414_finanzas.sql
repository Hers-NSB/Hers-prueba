create function public.finance_is_admin() returns boolean
language sql stable set search_path = ''
return coalesce(auth.jwt()->'app_metadata'->>'role' = 'admin', false);

revoke all on function public.finance_is_admin() from public, anon;
grant execute on function public.finance_is_admin() to authenticated;

create table public.finance_platforms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120)
);
create unique index finance_platform_name on public.finance_platforms (lower(btrim(name)));
insert into public.finance_platforms (id, name) values ('00000000-0000-4000-8000-000000000001', 'OnlyFans');

create table public.finance_creators (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  agencykey_id text unique
);

create table public.finance_members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  agencykey_id text unique
);

create table public.finance_rates (
  member_id uuid not null references public.finance_members,
  effective_on date not null,
  percent numeric(7,4) not null check (percent between 0 and 100),
  primary key (member_id, effective_on)
);

create table public.finance_movements (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  kind text not null check (kind in ('income','expense','investment')),
  category text not null check (length(btrim(category)) between 1 and 120),
  description text not null default '' check (length(description) <= 500),
  creator_id uuid references public.finance_creators,
  platform_id uuid references public.finance_platforms,
  amount numeric(16,2) not null,
  gross numeric(16,2),
  net numeric(16,2),
  check (
    (kind = 'income' and platform_id is not null and gross is not null and net is not null) or
    (kind <> 'income' and amount > 0 and gross is null and net is null)
  )
);

create table public.finance_agencykey_sales (
  day date not null,
  creator_id uuid not null references public.finance_creators,
  gross numeric(16,2) not null,
  net numeric(16,2) not null,
  primary key (day, creator_id)
);

create table public.finance_agencykey_attributions (
  day date not null,
  creator_id uuid not null references public.finance_creators,
  member_id uuid not null references public.finance_members,
  attributed numeric(16,2) not null,
  primary key (day, creator_id, member_id)
);

create table public.finance_sync (
  source text primary key,
  last_success timestamptz not null,
  through_day date not null
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'finance_platforms', 'finance_creators', 'finance_members', 'finance_rates',
    'finance_movements', 'finance_agencykey_sales', 'finance_agencykey_attributions', 'finance_sync'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('create policy finance_read on public.%I for select to authenticated using ((select public.finance_is_admin()))', table_name);
  end loop;
  foreach table_name in array array[
    'finance_platforms', 'finance_creators', 'finance_members', 'finance_rates', 'finance_movements'
  ] loop
    execute format('grant insert, update on public.%I to authenticated', table_name);
    execute format('create policy finance_insert on public.%I for insert to authenticated with check ((select public.finance_is_admin()))', table_name);
    execute format('create policy finance_update on public.%I for update to authenticated using ((select public.finance_is_admin())) with check ((select public.finance_is_admin()))', table_name);
  end loop;
end;
$$;

create index finance_movements_day on public.finance_movements(day);
create index finance_movements_creator on public.finance_movements(creator_id);
create index finance_movements_platform on public.finance_movements(platform_id);
create index finance_agencykey_sales_creator on public.finance_agencykey_sales(creator_id);
create index finance_agencykey_attributions_creator on public.finance_agencykey_attributions(creator_id);
create index finance_agencykey_attributions_member on public.finance_agencykey_attributions(member_id);

create view public.finance_commissions with (security_invoker = true) as
select a.day, a.creator_id, a.member_id, a.attributed, r.percent, r.effective_on,
       round(a.attributed * r.percent / 100, 2) as commission
from public.finance_agencykey_attributions a
left join lateral (
  select effective_on, percent from public.finance_rates
  where member_id = a.member_id and effective_on <= a.day
  order by effective_on desc limit 1
) r on true;

revoke all on public.finance_commissions from public, anon, authenticated;
grant select on public.finance_commissions to authenticated;

create function public.finance_import_agencykey(
  p_day date, p_sales jsonb, p_attributions jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_day is null or p_day >= current_date
     or jsonb_typeof(p_sales) is distinct from 'array'
     or jsonb_typeof(p_attributions) is distinct from 'array' then
    raise exception 'Fecha o formato de importación incorrecto';
  end if;

  perform pg_advisory_xact_lock(545650731, p_day - date '2000-01-01');

  insert into public.finance_creators (agencykey_id, name)
  select x.creator_key, x.creator_name
  from jsonb_to_recordset(p_sales) x(creator_key text, creator_name text)
  on conflict (agencykey_id) do update set name = excluded.name;

  insert into public.finance_members (agencykey_id, name)
  select x.member_key, max(x.member_name)
  from jsonb_to_recordset(p_attributions) x(member_key text, member_name text)
  group by x.member_key
  on conflict (agencykey_id) do update set name = excluded.name;

  delete from public.finance_agencykey_attributions where day = p_day;
  delete from public.finance_agencykey_sales where day = p_day;

  insert into public.finance_agencykey_sales (day, creator_id, gross, net)
  select p_day, c.id, x.gross, x.net
  from jsonb_to_recordset(p_sales) x(creator_key text, gross numeric, net numeric)
  left join public.finance_creators c on c.agencykey_id = x.creator_key;

  insert into public.finance_agencykey_attributions (day, creator_id, member_id, attributed)
  select p_day, s.creator_id, m.id, x.attributed
  from jsonb_to_recordset(p_attributions) x(creator_key text, member_key text, attributed numeric)
  left join public.finance_creators c on c.agencykey_id = x.creator_key
  left join public.finance_agencykey_sales s on s.day = p_day and s.creator_id = c.id
  left join public.finance_members m on m.agencykey_id = x.member_key;

  insert into public.finance_sync (source, last_success, through_day)
  values ('agencykey', clock_timestamp(), p_day)
  on conflict (source) do update
  set last_success = excluded.last_success,
      through_day = greatest(finance_sync.through_day, excluded.through_day);
end;
$$;

revoke all on function public.finance_import_agencykey(date, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.finance_import_agencykey(date, jsonb, jsonb) to service_role;
