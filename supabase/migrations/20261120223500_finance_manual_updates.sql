alter table public.finance_members
  add column role text not null default 'Chatter' check (length(btrim(role)) between 1 and 120),
  add column archived_on date;

create table public.finance_categories (
  name text primary key check (length(btrim(name)) between 1 and 120)
);
create unique index finance_categories_name_ci on public.finance_categories (lower(name));
insert into public.finance_categories(name)
select min(name)
from (
  select unnest(array['Operación','Marketing','Software','Producción','Equipos','Servicios']) as name
  union all
  select btrim(category) from public.finance_movements
) categories
group by lower(name);

alter table public.finance_categories enable row level security;
grant select, insert on public.finance_categories to authenticated;
create policy "Administración de categorías" on public.finance_categories
  for all to authenticated using ((select public.finance_is_admin())) with check ((select public.finance_is_admin()));

alter table public.finance_movements drop constraint finance_movements_check;
alter table public.finance_movements add constraint finance_movements_amounts check (
  (kind = 'income' and platform_id is not null and net is not null) or
  (kind <> 'income' and amount > 0 and gross is null and net is null)
);

alter table public.finance_agencykey_sales drop constraint finance_agencykey_sales_has_amount;
alter table public.finance_agencykey_sales add constraint finance_agencykey_sales_has_amount
  check (net is not null or crm_total is not null);

create or replace function public.finance_import_agencykey(
  p_day date, p_sales jsonb, p_attributions jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  p_attributions := nullif(p_attributions, 'null'::jsonb);

  if p_day is null or p_day > (now() at time zone 'America/Halifax')::date
     or jsonb_typeof(p_sales) is distinct from 'array'
     or (p_attributions is not null and jsonb_typeof(p_attributions) is distinct from 'array') then
    raise exception 'Fecha o formato de importación incorrecto';
  end if;

  perform pg_advisory_xact_lock(545650731, p_day - date '2000-01-01');

  insert into public.finance_creators (agencykey_id, name)
  select x.creator_key, x.creator_name
  from jsonb_to_recordset(p_sales) x(creator_key text, creator_name text)
  on conflict (agencykey_id) do update set name = excluded.name;

  if p_attributions is null then
    insert into public.finance_agencykey_sales (day, creator_id, net)
    select p_day, c.id, x.net
    from jsonb_to_recordset(p_sales) x(creator_key text, net numeric)
    join public.finance_creators c on c.agencykey_id = x.creator_key
    on conflict (day, creator_id) do update set net = excluded.net;
  else
    insert into public.finance_members (agencykey_id, name)
    select x.member_key, max(x.member_name)
    from jsonb_to_recordset(p_attributions) x(member_key text, member_name text)
    group by x.member_key
    on conflict (agencykey_id) do update set name = excluded.name;

    delete from public.finance_agencykey_attributions where day = p_day;

    insert into public.finance_agencykey_sales (day, creator_id, gross, net, crm_total)
    select p_day, c.id, x.gross, x.net, x.crm_total
    from jsonb_to_recordset(p_sales) x(creator_key text, gross numeric, net numeric, crm_total numeric)
    left join public.finance_creators c on c.agencykey_id = x.creator_key
    on conflict (day, creator_id) do update
      set gross = coalesce(excluded.gross, finance_agencykey_sales.gross),
          net = coalesce(excluded.net, finance_agencykey_sales.net),
          crm_total = excluded.crm_total;

    insert into public.finance_agencykey_attributions (day, creator_id, member_id, attributed)
    select p_day, s.creator_id, m.id, x.attributed
    from jsonb_to_recordset(p_attributions) x(creator_key text, member_key text, attributed numeric)
    left join public.finance_creators c on c.agencykey_id = x.creator_key
    left join public.finance_agencykey_sales s on s.day = p_day and s.creator_id = c.id
    left join public.finance_members m on m.agencykey_id = x.member_key;

  end if;

  insert into public.finance_sync (source, last_success, through_day)
  values ('agencykey', clock_timestamp(), p_day)
  on conflict (source) do update
  set last_success = excluded.last_success,
      through_day = greatest(finance_sync.through_day, excluded.through_day);
end;
$$;

