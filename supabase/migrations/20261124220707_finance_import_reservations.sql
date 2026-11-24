create table hers_private.finance_import_reservations (
  day date primary key,
  claim uuid not null,
  expires_at timestamptz not null
);

revoke all on hers_private.finance_import_reservations from public, anon, authenticated;

create or replace function public.hers_integration_worker(p_token text, p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  import_day date;
  import_claim uuid;
  report_zone text;
begin
  if p_token is null or length(p_token) <> 64 or not exists (
    select 1 from hers_private.integration_backend
    where token_hash = sha256(convert_to(p_token, 'UTF8'))
  ) then
    raise insufficient_privilege using message = 'Credencial de Worker inválida';
  end if;

  if p_action in ('reserve_import', 'release_import', 'import') then
    import_day := (p_data->>'p_day')::date;
    import_claim := (p_data->>'claim')::uuid;
    if import_day is null then raise invalid_parameter_value; end if;

    -- Use the same transaction lock as the payroll closer.
    select p.report_zone into report_zone from hers_private.finance_payroll p for update;
  end if;

  case p_action
  when 'reserve_import' then
    if import_claim is null then raise invalid_parameter_value; end if;
    if import_day > (statement_timestamp() at time zone report_zone)::date then
      return '{"future":true}';
    end if;
    if exists (select from hers_private.finance_final_days where day = import_day) then
      return '{"finalized":true}';
    end if;
    insert into hers_private.finance_import_reservations (day, claim, expires_at)
      values (import_day, import_claim, clock_timestamp() + interval '20 minutes')
      on conflict (day) do update
        set claim = excluded.claim, expires_at = excluded.expires_at
        where finance_import_reservations.expires_at <= clock_timestamp();
    return jsonb_build_object('acquired', found);
  when 'release_import' then
    delete from hers_private.finance_import_reservations where day = import_day and claim = import_claim;
    return jsonb_build_object('released', found);
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
    if exists (select from hers_private.finance_final_days where day = import_day) then
      return '{"finalized":true}';
    end if;
    if import_claim is not null then
      delete from hers_private.finance_import_reservations
        where day = import_day and claim = import_claim and expires_at > clock_timestamp();
      if not found then raise object_not_in_prerequisite_state using message = 'Reserva de importación vencida'; end if;
    elsif exists (select from hers_private.finance_import_reservations
      where day = import_day and expires_at > clock_timestamp()) then
      raise object_not_in_prerequisite_state using message = 'Día reservado por otra importación';
    end if;
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
