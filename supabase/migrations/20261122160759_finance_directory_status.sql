create or replace function public.hers_agencykey_directory(p_token text, p_action text, p_data jsonb default '{}')
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
  when 'status' then
    result := jsonb_build_object('connected', exists (
      select from hers_private.agencykey_directory_connection where singleton
    ));
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
      update hers_private.agencykey_directory_connection set checked_at = (p_data->>'started_at')::timestamptz
      where singleton and revision = (p_data->>'revision')::uuid;
    end if;
    result := '{"saved":true}';
  else
    raise invalid_parameter_value using message = 'Operación no válida';
  end case;
  return result;
end;
$$;

