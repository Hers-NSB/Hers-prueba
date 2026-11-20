create schema if not exists hers_private;
revoke all on schema hers_private from public, anon, authenticated;

create table hers_private.integration_backend (
  singleton boolean primary key default true check (singleton),
  token_hash bytea not null check (octet_length(token_hash) = 32)
);

create table hers_private.integration_credentials (
  service text not null check (service ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  kind text not null check (kind in ('api-key', 'token', 'password')),
  ciphertext text not null check (length(ciphertext) between 40 and 6500),
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  primary key (service, kind),
  check (service <> 'agencykey' or kind = 'api-key')
);

alter table hers_private.integration_backend enable row level security;
alter table hers_private.integration_credentials enable row level security;

create function public.hers_integration_worker(p_token text, p_action text, p_data jsonb default '{}')
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
    result := '{"imported":true}';
  else
    raise invalid_parameter_value using message = 'Operación no válida';
  end case;
  return result;
end;
$$;

revoke all on function public.hers_integration_worker(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.hers_integration_worker(text,text,jsonb) to anon;
