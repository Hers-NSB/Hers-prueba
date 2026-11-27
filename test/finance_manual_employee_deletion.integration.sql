begin;

do $$
declare
  staff uuid;
  second_staff uuid;
  chatter uuid;
  model uuid;
  paid_cut uuid;
  pending_cut uuid;
  first_day date := '2001-02-01';
begin
  insert into public.finance_members (name, role) values ('Empleado manual A', 'Chatter') returning id into staff;
  insert into public.finance_members (name, role) values ('Empleado manual B', 'Dropper') returning id into second_staff;
  insert into public.finance_members (name, role, agencykey_id)
    values ('Chatter vinculado', 'Chatter', gen_random_uuid()::text) returning id into chatter;
  insert into public.finance_creators (name) values ('Modelo manual de prueba') returning id into model;
  insert into public.finance_payments (period_start, period_end, member_id, amount)
    values (first_day, first_day + 14, staff, 21) returning id into paid_cut;
  insert into public.finance_payments (period_start, period_end, member_id, amount)
    values (first_day, first_day + 14, second_staff, 19) returning id into pending_cut;

  perform set_config('hers.test.staff', staff::text, true);
  perform set_config('hers.test.second_staff', second_staff::text, true);
  perform set_config('hers.test.chatter', chatter::text, true);
  perform set_config('hers.test.model', model::text, true);
  perform set_config('hers.test.paid_cut', paid_cut::text, true);
  perform set_config('hers.test.pending_cut', pending_cut::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1aa14c3-b3ae-4c8b-96c3-5944c69cd00d","app_metadata":{"role":"chatter"}}', true);
do $$
begin
  begin
    perform public.finance_delete_manual_member(current_setting('hers.test.staff')::uuid);
    raise exception 'Solo un administrador puede eliminar empleados';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"a1aa14c3-b3ae-4c8b-96c3-5944c69cd00d","app_metadata":{"role":"admin"}}', true);
do $$
declare
  staff uuid := current_setting('hers.test.staff')::uuid;
  second_staff uuid := current_setting('hers.test.second_staff')::uuid;
  chatter uuid := current_setting('hers.test.chatter')::uuid;
  model uuid := current_setting('hers.test.model')::uuid;
  paid_cut uuid := current_setting('hers.test.paid_cut')::uuid;
  pending_cut uuid := current_setting('hers.test.pending_cut')::uuid;
  movement uuid;
begin
  perform public.finance_save_current_member_pay(staff, 'Empleado manual A', 'Chatter',
    25, array[model], 25, array[chatter]);
  if not exists (select from public.finance_model_shares where member_id = staff and basis = 'model_sales'
    and creator_ids = array[model] and percent = 25 and chatter_ids = array[chatter] and chatter_percent = 25) then
    raise exception 'Un empleado manual puede aplicar el mismo porcentaje a modelos y chatters';
  end if;
  perform public.finance_save_current_member_pay(staff, 'Empleado manual A', 'Chatter',
    0, '{}', 25, array[chatter]);
  if not exists (select from public.finance_model_shares where member_id = staff and cardinality(creator_ids) = 0
    and percent = 0 and chatter_ids = array[chatter] and chatter_percent = 25) then
    raise exception 'La asignación de chatters no requiere modelos';
  end if;

  if not public.finance_confirm_payment(paid_cut) then
    raise exception 'Falló el pago previo a la eliminación';
  end if;
  select id into strict movement from public.finance_movements where finance_payment_id = paid_cut;
  perform public.finance_delete_manual_member(staff);
  perform public.finance_delete_manual_member(second_staff);
  if exists (select from public.finance_members where id in (staff, second_staff))
    or exists (select from public.finance_model_shares where member_id = staff) then
    raise exception 'Deben eliminarse los empleados y sus asignaciones';
  end if;
  if not exists (select from public.finance_payments where id = paid_cut and member_id is null
    and deleted_member_id = staff and deleted_member_name = 'Empleado manual A' and paid_at is not null and amount = 21)
    or not exists (select from public.finance_movements where id = movement and finance_payment_id = paid_cut and amount = 21) then
    raise exception 'Deben conservarse el corte pagado y su movimiento original';
  end if;
  if not public.finance_confirm_payment(pending_cut) then
    raise exception 'Debe poder pagarse un corte pendiente tras eliminar al empleado';
  end if;
  if not exists (select from public.finance_movements where finance_payment_id = pending_cut
    and description like 'Empleado manual B%' and amount = 19) then
    raise exception 'El pago posterior debe reflejar el nombre original del empleado';
  end if;

  begin
    perform public.finance_delete_manual_member(chatter);
    raise exception 'Un chatter vinculado no se puede eliminar como empleado manual';
  exception when invalid_parameter_value then
    null;
  end;
end;
$$;

rollback;
