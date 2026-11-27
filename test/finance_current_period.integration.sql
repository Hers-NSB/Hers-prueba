begin;

do $$
declare
  period_start date;
  report_day date;
  last_period date;
  first_model uuid;
  second_model uuid;
  other_model uuid;
  staff uuid;
  inactive_chatter uuid;
  chatter_key text := gen_random_uuid()::text;
begin
  select (statement_timestamp() at time zone report_zone)::date into report_day from hers_private.finance_payroll;
  period_start := public.finance_pay_period_start(report_day);
  last_period := public.finance_pay_period_start(period_start - 1);
  insert into public.finance_creators (name) values ('Modelo de pruebas 1') returning id into first_model;
  insert into public.finance_creators (name) values ('Modelo de pruebas 2') returning id into second_model;
  insert into public.finance_creators (name) values ('Modelo sin asignar de pruebas') returning id into other_model;
  insert into public.finance_members (name, role) values ('Empleado manual de pruebas', 'Dropper') returning id into staff;

  insert into public.finance_agencykey_sales (creator_id, day, net)
  values (first_model, period_start, 100.05), (second_model, period_start, 50.05), (other_model, period_start, 300);
  insert into public.finance_model_shares (member_id, effective_on, percent, creator_ids)
  values (staff, last_period, 10, array[first_model]), (staff, period_start, 20, array[first_model, second_model]),
    (staff, period_start + 1, 35, array[other_model]), (staff, period_start + 16, 15, array[second_model]);
  insert into public.finance_payments (period_start, period_end, member_id, amount, net_sales, pay_rate_min, pay_rate_max)
  values (last_period, period_start - 1, staff, 9, 90, 10, 10);

  insert into public.finance_members (name, role, agencykey_id, agencykey_available)
  values ('Chatter inactivo de pruebas', 'Chatter', chatter_key, false) returning id into inactive_chatter;
  insert into public.finance_model_shares (member_id, effective_on, percent, basis)
  values (inactive_chatter, period_start, 10, 'employee_sales');
  insert into public.finance_member_availability (member_id, effective_on, available)
  values (inactive_chatter, period_start, false);
  insert into public.finance_agencykey_employee_net (day, totals)
  values (period_start, jsonb_build_object(chatter_key, 209.16))
  on conflict (day) do update set totals = finance_agencykey_employee_net.totals || excluded.totals;

  perform set_config('hers.test.inactive_chatter', inactive_chatter::text, true);
  perform set_config('hers.test.manual_period', period_start::text, true);
  perform set_config('hers.test.manual_staff', staff::text, true);
  perform set_config('hers.test.first_model', first_model::text, true);
  perform set_config('hers.test.second_model', second_model::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1aa14c3-b3ae-4c8b-96c3-5944c69cd00d","app_metadata":{"role":"chatter"}}', true);
do $$
begin
  begin
    perform public.finance_save_current_pay_rate(current_setting('hers.test.manual_staff')::uuid, null, 'Prueba', 'Dropper', 50, '{}');
    raise exception 'Solo un administrador debe poder cambiar el porcentaje';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"a1aa14c3-b3ae-4c8b-96c3-5944c69cd00d","app_metadata":{"role":"admin"}}', true);
do $$
declare
  staff uuid := current_setting('hers.test.manual_staff')::uuid;
  first_model uuid := current_setting('hers.test.first_model')::uuid;
  second_model uuid := current_setting('hers.test.second_model')::uuid;
  current_pay jsonb := public.finance_current_pay();
  cut_start date := (current_pay->>'from')::date;
  recipient text := 'chatter:' || staff;
  category_name text := 'Categoría ' || gen_random_uuid();
begin
  if (current_pay->'sales'->>recipient)::numeric is distinct from 150.10
     or (current_pay->'amounts'->>recipient)::numeric is distinct from 30 then
    raise exception 'El pago manual debe sumar solo las ventas de sus modelos asignados en la fecha de cada venta';
  end if;

  if (current_pay->'amounts'->>('chatter:' || current_setting('hers.test.inactive_chatter')))::numeric
      is distinct from 21 then
    raise exception 'El chatter inactivo conserva la comisión sobre ventas atribuidas con porcentaje vigente';
  end if;

  perform public.finance_save_current_member_pay(staff, 'Empleado manual de pruebas', 'Dropper',
    20, array[first_model, second_model], 10, array[current_setting('hers.test.inactive_chatter')::uuid]);
  current_pay := public.finance_current_pay();
  if (current_pay->'sales'->>recipient)::numeric is distinct from 359.26
     or (current_pay->'amounts'->>recipient)::numeric is distinct from 51 then
    raise exception 'El pago debe acumular el porcentaje de modelos y el de chatters';
  end if;

  perform public.finance_save_current_member_pay(staff, 'Empleado manual de pruebas', 'Dropper',
    20, array[first_model, second_model], 0, '{}'::uuid[]);
  perform public.finance_save_current_pay_rate(staff, null, 'Empleado manual de pruebas', 'Dropper', 50, array[first_model, second_model]);
  current_pay := public.finance_current_pay();
  if (current_pay->'sales'->>recipient)::numeric is distinct from 150.10
     or (current_pay->'amounts'->>recipient)::numeric is distinct from 75
     or (select count(*) from public.finance_model_shares where member_id = staff
       and effective_on in (cut_start, cut_start + 1) and percent = 50 and creator_ids = array[first_model, second_model]) <> 2
     or not exists (select from public.finance_model_shares where member_id = staff and effective_on = cut_start + 16 and percent = 15)
     or not exists (select from public.finance_payments p where p.member_id = staff and p.period_end = cut_start - 1 and amount = 9) then
    raise exception 'La nueva tasa debe cubrir toda la quincena y preservar el corte anterior y la vigencia futura';
  end if;

  perform public.finance_save_current_pay_rate(null, first_model, null, null, 25, '{}');
  if (public.finance_current_pay()->'amounts'->>('model:' || first_model))::numeric is distinct from 25 then
    raise exception 'El modelo debe cobrar según el nuevo porcentaje de toda la quincena';
  end if;

  insert into public.finance_categories (name, description) values (category_name, 'Descripción inicial');
  insert into public.finance_movements (day, kind, category, description, amount)
    values (cut_start, 'investment', category_name, E'Línea uno\nLínea dos', 10);
  perform public.finance_update_category(category_name, category_name || ' editada', E'Descripción\nactualizada');
  if not exists (select from public.finance_categories where name = category_name || ' editada' and description = E'Descripción\nactualizada')
     or not exists (select from public.finance_movements where finance_movements.category = category_name || ' editada'
       and description = E'Línea uno\nLínea dos') then
    raise exception 'La categoría debe guardar su descripción y mantener la descripción propia del movimiento';
  end if;
end;
$$;

reset role;
do $$
declare
  staff uuid := current_setting('hers.test.manual_staff')::uuid;
  cutoff date := current_setting('hers.test.manual_period')::date;
begin
  if not exists (select from hers_private.finance_period_pay_details(cutoff, cutoff + 1)
      where member_id = staff and amount = 75 and net_sales = 150.10 and pay_rate_min = 50 and pay_rate_max = 50) then
    raise exception 'El cierre debe tomar la misma base e importe que el estimado';
  end if;
  if not exists (select from hers_private.finance_period_pay_details(cutoff, cutoff + 1)
      where member_id = current_setting('hers.test.inactive_chatter')::uuid and amount = 21 and net_sales = 209.16) then
    raise exception 'El cierre conserva el pago del chatter inactivo';
  end if;
end;
$$;

rollback;
