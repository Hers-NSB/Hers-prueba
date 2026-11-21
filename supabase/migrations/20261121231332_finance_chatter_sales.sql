alter table public.finance_model_shares
  add column basis text not null default 'model_sales',
  drop constraint finance_model_shares_check2,
  add constraint finance_model_shares_basis check (
    (basis = 'employee_sales' and member_id is not null and cardinality(creator_ids) = 0)
    or (basis = 'model_sales' and (member_id is null or percent = 0 or cardinality(creator_ids) > 0))
  );

create table public.finance_agencykey_employee_net (
  day date primary key,
  totals jsonb not null check (jsonb_typeof(totals) = 'object')
);
alter table public.finance_agencykey_employee_net enable row level security;
revoke all on public.finance_agencykey_employee_net from public, anon, authenticated;
grant select on public.finance_agencykey_employee_net to authenticated;
create policy finance_agencykey_employee_net_read on public.finance_agencykey_employee_net
  for select to authenticated using ((select public.finance_is_admin()));

create or replace function public.finance_save_member_share(
  p_member_id uuid, p_agencykey_id text, p_name text, p_role text,
  p_effective_on date, p_percent numeric, p_creator_ids uuid[]
) returns void language plpgsql set search_path = '' as $$
declare
  member_key uuid;
  member_role text;
  share_basis text;
begin
  if p_member_id is not null then
    update public.finance_members
      set name = case when agencykey_id is null then btrim(p_name) else name end,
          role = case when agencykey_id is null then btrim(p_role) else role end
      where id = p_member_id and archived_on is null returning id, role into member_key, member_role;
  elsif p_agencykey_id is not null then
    insert into public.finance_members (agencykey_id, name, role)
    values (p_agencykey_id, btrim(p_name), btrim(p_role))
    on conflict (agencykey_id) do update set name = excluded.name, role = excluded.role, archived_on = null
    returning id, role into member_key, member_role;
  else
    insert into public.finance_members (name, role) values (btrim(p_name), btrim(p_role))
    returning id, role into member_key, member_role;
  end if;

  share_basis := case when member_role ~* '(^|,) *chatters? *(,|$)' then 'employee_sales' else 'model_sales' end;
  insert into public.finance_model_shares (member_id, effective_on, percent, creator_ids, basis)
    values (member_key, p_effective_on, p_percent,
      case when share_basis = 'employee_sales' then '{}'::uuid[] else p_creator_ids end, share_basis)
    on conflict (member_id, creator_id, effective_on) do update
    set percent = excluded.percent, creator_ids = excluded.creator_ids, basis = excluded.basis;
end;
$$;

create or replace function public.hers_integration_worker(p_token text, p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if p_token is null or length(p_token) <> 64 or not exists (
    select 1 from hers_private.integration_backend
    where token_hash = sha256(convert_to(p_token, 'UTF8'))
  ) then
    raise insufficient_privilege using message = 'Credencial de Worker inválida';
  end if;

  case p_action
  when 'status' then
    select jsonb_build_object(
      'credentials', coalesce((select jsonb_agg(
        jsonb_build_object('service', c.service, 'kind', c.kind, 'updated_at', c.updated_at)
        order by c.service, c.kind
      ) from hers_private.integration_credentials c), '[]'::jsonb),
      'sync', (select jsonb_build_object('last_success', s.last_success, 'through_day', s.through_day)
      from public.finance_sync s where s.source = 'agencykey')
    ) into result;
  when 'save' then
    insert into hers_private.integration_credentials(service, kind, ciphertext, updated_by)
    values (p_data->>'service', p_data->>'kind', p_data->>'ciphertext', (p_data->>'updated_by')::uuid)
    on conflict (service, kind) do update set
      ciphertext = excluded.ciphertext, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    result := '{"saved":true}';
  when 'agencykey' then
    select jsonb_build_object('ciphertext', ciphertext) into result
    from hers_private.integration_credentials where service = 'agencykey' and kind = 'api-key';
  when 'import' then
    perform public.finance_import_agencykey(
      (p_data->>'p_day')::date, p_data->'p_sales', p_data->'p_attributions'
    );
    if p_data ? 'p_employee_net' then
      insert into public.finance_agencykey_employee_net (day, totals)
        values ((p_data->>'p_day')::date, p_data->'p_employee_net')
        on conflict (day) do update set totals = excluded.totals;
    end if;
    result := '{"imported":true}';
  else
    raise invalid_parameter_value using message = 'Operación no válida';
  end case;
  return result;
end;
$$;
