alter table public.finance_agencykey_sales
  alter column gross drop not null,
  alter column net drop not null,
  add column crm_total numeric(16,2),
  add constraint finance_agencykey_sales_has_amount
    check ((gross is not null and net is not null) or crm_total is not null);
create or replace function public.finance_import_agencykey(
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

  insert into public.finance_agencykey_sales (day, creator_id, gross, net, crm_total)
  select p_day, c.id, x.gross, x.net, x.crm_total
  from jsonb_to_recordset(p_sales) x(creator_key text, gross numeric, net numeric, crm_total numeric)
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
