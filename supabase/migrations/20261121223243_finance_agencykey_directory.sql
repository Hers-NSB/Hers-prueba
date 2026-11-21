alter table public.finance_members add column agencykey_available boolean not null default true;
alter table public.finance_creators add column agencykey_available boolean not null default true;

create table public.finance_member_availability (
  member_id uuid not null references public.finance_members,
  effective_on date not null,
  available boolean not null,
  primary key (member_id, effective_on)
);
alter table public.finance_member_availability enable row level security;
revoke all on table public.finance_member_availability from public, anon, authenticated;
grant select on table public.finance_member_availability to authenticated;
create policy finance_member_availability_read on public.finance_member_availability for select to authenticated
  using ((select public.finance_is_admin()));

create table hers_private.agencykey_directory_connection (
  singleton boolean primary key default true check (singleton),
  ciphertext text not null check (length(ciphertext) between 40 and 24000),
  connected_by uuid not null,
  revision uuid not null default gen_random_uuid(),
  refresh_lease uuid,
  refresh_until timestamptz,
  checked_at timestamptz
);
alter table hers_private.agencykey_directory_connection enable row level security;
revoke all on table hers_private.agencykey_directory_connection from public, anon, authenticated;

create function hers_private.apply_agencykey_directory(p_snapshot jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  report_date date := (statement_timestamp() at time zone 'America/Halifax')::date;
begin
  if jsonb_typeof(p_snapshot->'employees') is distinct from 'array'
     or jsonb_typeof(p_snapshot->'creators') is distinct from 'array'
     or not exists (select from jsonb_to_recordset(p_snapshot->'employees') x(id text, active boolean) where active) then
    raise invalid_parameter_value using message = 'Directorio incompleto';
  end if;

  with employee_directory as (
    select * from jsonb_to_recordset(p_snapshot->'employees') directory(id text, name text, role text, active boolean)
  ), changes as (
    select m.id, coalesce(d.active, false) as available from public.finance_members m
    left join employee_directory d on d.id = m.agencykey_id
    where m.agencykey_id is not null and m.agencykey_available is distinct from coalesce(d.active, false)
  )
  insert into public.finance_member_availability (member_id, effective_on, available)
  select id, report_date, available from changes
  on conflict (member_id, effective_on) do update set available = excluded.available;

  update public.finance_members m
    set name = coalesce(d.name, m.name), role = coalesce(d.role, m.role), agencykey_available = coalesce(d.active, false)
  from public.finance_members existing
  left join jsonb_to_recordset(p_snapshot->'employees') d(id text, name text, role text, active boolean)
    on d.id = existing.agencykey_id
  where m.id = existing.id and m.agencykey_id is not null
    and (m.name, m.role, m.agencykey_available) is distinct from
      (coalesce(d.name, m.name), coalesce(d.role, m.role), coalesce(d.active, false));

  insert into public.finance_creators (agencykey_id, name, agencykey_available)
  select id, name, true from jsonb_to_recordset(p_snapshot->'creators') x(id text, name text)
  on conflict (agencykey_id) do update set name = excluded.name, agencykey_available = true
    where (finance_creators.name, finance_creators.agencykey_available)
      is distinct from (excluded.name, true);

  update public.finance_creators c set agencykey_available = false
  where c.agencykey_id is not null and c.agencykey_available and not exists (
    select from jsonb_to_recordset(p_snapshot->'creators') x(id text) where x.id = c.agencykey_id
  );
end;
$$;

revoke all on function hers_private.apply_agencykey_directory(jsonb) from public, anon, authenticated;

create function public.hers_agencykey_directory(p_token text, p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  version uuid;
  checked timestamptz;
begin
  if p_token is null or length(p_token) <> 64 or not exists (
    select from hers_private.integration_backend where token_hash = sha256(convert_to(p_token, 'UTF8'))
  ) then
    raise insufficient_privilege using message = 'Credencial de Worker inválida';
  end if;

  case p_action
  when 'load' then
    select jsonb_build_object('ciphertext', ciphertext, 'revision', revision)
      into result from hers_private.agencykey_directory_connection;
  when 'connect' then
    insert into hers_private.agencykey_directory_connection (ciphertext, connected_by, checked_at)
    values (p_data->>'connection', (p_data->>'user')::uuid, statement_timestamp())
    on conflict (singleton) do update set ciphertext = excluded.ciphertext, connected_by = excluded.connected_by,
      revision = gen_random_uuid(), refresh_lease = null, refresh_until = null, checked_at = excluded.checked_at;
    perform hers_private.apply_agencykey_directory(p_data->'snapshot');
    result := '{"saved":true}';
  when 'claim' then
    update hers_private.agencykey_directory_connection
    set refresh_lease = (p_data->>'lease')::uuid, refresh_until = clock_timestamp() + interval '30 seconds'
    where revision = (p_data->>'revision')::uuid and (refresh_lease is null or refresh_until < clock_timestamp());
    result := jsonb_build_object('claimed', found);
  when 'refresh' then
    update hers_private.agencykey_directory_connection
    set ciphertext = p_data->>'connection', revision = gen_random_uuid(), refresh_lease = null, refresh_until = null
    where refresh_lease = (p_data->>'lease')::uuid returning revision into version;
    result := jsonb_build_object('saved', found, 'revision', version);
  when 'release' then
    update hers_private.agencykey_directory_connection
    set refresh_lease = null, refresh_until = null where refresh_lease = (p_data->>'lease')::uuid;
    result := '{"ok":true}';
  when 'snapshot' then
    select checked_at into checked from hers_private.agencykey_directory_connection
    where revision = (p_data->>'revision')::uuid for update;
    if not found then return '{"saved":false}'; end if;
    if checked is null or checked <= (p_data->>'started_at')::timestamptz then
      perform hers_private.apply_agencykey_directory(p_data->'snapshot');
      update hers_private.agencykey_directory_connection set checked_at = (p_data->>'started_at')::timestamptz;
    end if;
    result := '{"saved":true}';
  else
    raise invalid_parameter_value using message = 'Operación no válida';
  end case;
  return result;
end;
$$;

revoke all on function public.hers_agencykey_directory(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.hers_agencykey_directory(text,text,jsonb) to anon;
