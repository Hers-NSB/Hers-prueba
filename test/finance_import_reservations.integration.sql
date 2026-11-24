begin;

insert into hers_private.integration_backend(token_hash)
values (sha256(convert_to(repeat('a', 64), 'UTF8')))
on conflict (singleton) do update set token_hash = excluded.token_hash;

do $$
declare
  token text := repeat('a', 64);
  day date := (statement_timestamp() at time zone 'America/Halifax')::date - 300;
  first_claim uuid := gen_random_uuid();
  other_claim uuid := gen_random_uuid();
  creator text := gen_random_uuid()::text;
  payload jsonb := jsonb_build_object('p_day', day, 'claim', first_claim, 'p_attributions', null,
    'p_sales', jsonb_build_array(jsonb_build_object('creator_key', creator, 'creator_name', 'Prueba', 'net', 20)),
    'p_employee_net', '{}'::jsonb);
  other jsonb := payload || jsonb_build_object('claim', other_claim);
begin
  if public.hers_integration_worker(token, 'reserve_import', payload) <> '{"acquired":true}'
    or public.hers_integration_worker(token, 'reserve_import', other) <> '{"acquired":false}' then
    raise exception 'Dos importadores reservaron el mismo día';
  end if;
  begin
    perform public.hers_payroll_worker(token, 'import', other);
    raise exception 'El cron aceptó una reserva ajena';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.hers_integration_worker(token, 'import', payload - 'claim');
    raise exception 'La ruta anterior sobrescribió un día reservado';
  exception when object_not_in_prerequisite_state then null;
  end;

  perform public.hers_integration_worker(token, 'release_import', payload);
  if public.hers_integration_worker(token, 'reserve_import', other) <> '{"acquired":true}' then
    raise exception 'No se pudo reintentar al liberar la reserva';
  end if;
  perform public.hers_payroll_worker(token, 'import', other);
  if public.hers_integration_worker(token, 'reserve_import', payload) <> '{"finalized":true}' then
    raise exception 'Un día finalizado volvió a quedar disponible';
  end if;
  if public.hers_integration_worker(token, 'import',
    jsonb_set(payload - 'claim', '{p_sales,0,net}', '999')) <> '{"finalized":true}' or
    (select s.net from public.finance_agencykey_sales s join public.finance_creators c on c.id = s.creator_id
      where s.day = (payload->>'p_day')::date and c.agencykey_id = creator) is distinct from 20 then
    raise exception 'La importación posterior cambió el neto final';
  end if;
end;
$$;

rollback;
