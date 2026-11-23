begin;

do $$
declare
  model_key text := gen_random_uuid()::text;
  chatter_key text := gen_random_uuid()::text;
  model_id uuid;
  chatter_id uuid;
  token text := repeat('9', 64);
  cutoff date := '2001-02-15';
  payload jsonb;
begin
  insert into hers_private.integration_backend (token_hash)
    values (sha256(convert_to(token, 'UTF8'))) on conflict (singleton) do update set token_hash = excluded.token_hash;

  perform hers_private.apply_agencykey_directory(jsonb_build_object(
    'employees', jsonb_build_array(jsonb_build_object('id', chatter_key, 'name', 'Chatter de pago', 'role', 'Chatter', 'active', true)),
    'creators', jsonb_build_array(jsonb_build_object('id', model_key, 'name', 'Modelo de pago'))
  ));
  select id into strict model_id from public.finance_creators where agencykey_id = model_key;
  select id into strict chatter_id from public.finance_members where agencykey_id = chatter_key;

  insert into public.finance_model_shares (creator_id, effective_on, percent)
    values (model_id, '2001-02-01', 20), (model_id, cutoff, 30);
  insert into public.finance_model_shares (member_id, effective_on, percent, basis)
    values (chatter_id, '2001-02-01', 25, 'employee_sales');
  insert into public.finance_agencykey_sales (creator_id, day, net)
    values (model_id, cutoff - 1, 125.25);
  insert into public.finance_payments (period_start, period_end, creator_id, amount)
    values ('2001-01-16', '2001-01-31', model_id, 50.13);
  update hers_private.finance_payroll set next_period = '2001-02-01';
  insert into hers_private.finance_final_days (day) select cutoff - n from generate_series(1, 14) as n;

  if public.hers_payroll_worker(token, 'next')->>'day' <> cutoff::text
     or exists (select from public.finance_payments p where p.creator_id = model_id and p.period_end = cutoff) then
    raise exception 'Debe esperar al último día completo de la quincena';
  end if;

  payload := jsonb_build_object(
    'p_day', cutoff,
    'p_sales', jsonb_build_array(jsonb_build_object('creator_key', model_key, 'creator_name', 'Modelo de pago', 'net', 100)),
    'p_employee_net', jsonb_build_object(chatter_key, 100)
  );
  perform public.hers_payroll_worker(token, 'import', payload);
  perform public.hers_payroll_worker(token, 'import', payload);
  if (select count(*) from public.finance_payments p
      where p.paid_at is null and p.period_end = cutoff
        and ((p.creator_id = model_id and p.amount = 55.05 and p.net_sales = 225.25
          and p.pay_rate_min = 20 and p.pay_rate_max = 30)
          or (p.member_id = chatter_id and p.amount = 25 and p.net_sales = 100
          and p.pay_rate_min = 25 and p.pay_rate_max = 25))) <> 2 then
    raise exception 'El cierre debe registrar una sola vez el pago con el porcentaje vigente de cada día';
  end if;

  update public.finance_model_shares set percent = 40 where creator_id = model_id and effective_on = cutoff;
  if not exists (select from public.finance_payments where creator_id = model_id and period_end = cutoff
      and net_sales = 225.25 and pay_rate_min = 20 and pay_rate_max = 30 and amount = 55.05)
     or not exists (select from public.finance_payments where creator_id = model_id and period_end = '2001-01-31'
      and net_sales is null and pay_rate_min is null and pay_rate_max is null and amount = 50.13) then
    raise exception 'El historial debe conservar sus importes y los datos capturados al cierre';
  end if;

  if public.finance_pay_period_start('2028-02-29') <> date '2028-02-16'
     or public.finance_pay_period_start('2028-03-01') <> date '2028-03-01' then
    raise exception 'El cambio de quincena debe funcionar al final de febrero';
  end if;

  perform set_config('hers.test.payment_model', (
    select id::text from public.finance_payments where creator_id = model_id and period_end = cutoff), true);
  perform set_config('hers.test.payment_chatter', (
    select id::text from public.finance_payments where member_id = chatter_id and period_end = cutoff), true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1aa14c3-b3ae-4c8b-96c3-5944c69cd00d","app_metadata":{"role":"chatter"}}', true);
do $$
begin
  if public.finance_confirm_payment(current_setting('hers.test.payment_model')::uuid)
     or exists (select from public.finance_payments) then
    raise exception 'Un chatter no puede confirmar ni ver pagos';
  end if;
  begin
    perform public.finance_current_pay();
    raise exception 'Un chatter no puede consultar la quincena actual';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"a1aa14c3-b3ae-4c8b-96c3-5944c69cd00d","app_metadata":{"role":"admin"}}', true);
do $$
declare
  pay_id uuid := current_setting('hers.test.payment_model')::uuid;
  chatter_pay_id uuid := current_setting('hers.test.payment_chatter')::uuid;
begin
  if not public.finance_confirm_payment(pay_id) or public.finance_confirm_payment(pay_id) then
    raise exception 'La confirmación debe ser idempotente';
  end if;
  if not public.finance_confirm_payment(chatter_pay_id) then
    raise exception 'Debe poder confirmarse el pago de un chatter';
  end if;
  if (select count(*) from public.finance_movements m
      join public.finance_payments p on p.id = m.finance_payment_id
      where p.id in (pay_id, chatter_pay_id)
        and p.paid_by = auth.uid() and m.amount = p.amount and m.kind = 'investment'
        and m.category = case when p.creator_id is null then 'Equipo' else 'Modelo' end
        and m.day = (p.paid_at at time zone 'America/Halifax')::date
        and m.creator_id is not distinct from p.creator_id) <> 2 then
    raise exception 'Debe registrarse una inversión por el importe exacto en la fecha de confirmación';
  end if;
  begin
    update public.finance_movements set amount = 1 where finance_payment_id = pay_id;
    raise exception 'No debe permitirse alterar la inversión de un pago confirmado';
  exception when check_violation then
    null;
  end;

  if public.finance_current_pay()->'amounts' ? ('model:' || (
    select creator_id from public.finance_payments where id = pay_id
  )::text) then
    raise exception 'El total actual no debe incluir cortes anteriores';
  end if;
end;
$$;

reset role;
do $$
declare
  report_day date;
  start_day date;
  model uuid;
  employee uuid;
  employee_key text;
begin
  select (statement_timestamp() at time zone report_zone)::date into report_day from hers_private.finance_payroll;
  start_day := public.finance_pay_period_start(report_day);
  select creator_id into strict model from public.finance_payments where id = current_setting('hers.test.payment_model')::uuid;
  select p.member_id, m.agencykey_id into strict employee, employee_key
    from public.finance_payments p join public.finance_members m on m.id = p.member_id
    where p.id = current_setting('hers.test.payment_chatter')::uuid;

  insert into public.finance_agencykey_sales (creator_id, day, net) values (model, report_day, 250.25);
  insert into public.finance_agencykey_employee_net (day, totals) values (report_day, jsonb_build_object(employee_key, 80.40))
    on conflict (day) do update set totals = finance_agencykey_employee_net.totals || excluded.totals;
  insert into hers_private.finance_final_days (day)
    select report_day - 1 where report_day > start_day on conflict do nothing;

  perform set_config('hers.test.current_report_day', report_day::text, true);
  perform set_config('hers.test.current_model', 'model:' || model, true);
  perform set_config('hers.test.current_chatter', 'chatter:' || employee, true);
end;
$$;

set local role authenticated;
do $$
declare
  current_pay jsonb := public.finance_current_pay();
  report_day date := current_setting('hers.test.current_report_day')::date;
  start_day date := (current_pay->>'from')::date;
  model_key text := current_setting('hers.test.current_model');
  employee_key text := current_setting('hers.test.current_chatter');
begin
  if (current_pay->'sales'->>model_key)::numeric is distinct from 250.25
     or (current_pay->'sales'->>employee_key)::numeric is distinct from 80.40
     or (current_pay->'amounts'->>model_key)::numeric is distinct from 100.10
     or (current_pay->'amounts'->>employee_key)::numeric is distinct from 20.10 then
    raise exception 'La quincena actual debe mostrar las ventas y el pago estimado de cada persona';
  end if;
  if (current_pay->>'importedDays')::integer is distinct from (report_day > start_day)::integer
     or (current_pay->>'totalDays')::integer is distinct from (current_pay->>'to')::date - start_day + 1 then
    raise exception 'El avance de la quincena debe contar solo los días confirmados del período actual';
  end if;
  if exists (select from public.finance_payments where period_start = start_day
      and (('model:' || creator_id) = model_key or ('chatter:' || member_id) = employee_key)) then
    raise exception 'Consultar el estimado no debe generar cortes';
  end if;
end;
$$;

reset role;
delete from public.finance_model_shares
where ('model:' || creator_id) = current_setting('hers.test.current_model')
   or ('chatter:' || member_id) = current_setting('hers.test.current_chatter');

set local role authenticated;
do $$
declare
  current_pay jsonb := public.finance_current_pay();
  model_key text := current_setting('hers.test.current_model');
  employee_key text := current_setting('hers.test.current_chatter');
begin
  if (current_pay->'sales'->>model_key)::numeric is distinct from 250.25
     or (current_pay->'sales'->>employee_key)::numeric is distinct from 80.40 then
    raise exception 'Las ventas importadas deben mostrarse aunque falte configurar el porcentaje';
  end if;
  if (current_pay->'amounts') ? model_key or (current_pay->'amounts') ? employee_key then
    raise exception 'Sin un porcentaje vigente no corresponde calcular un pago';
  end if;
end;
$$;

rollback;
