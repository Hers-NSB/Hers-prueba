begin;

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);

do $$
declare
  v_category text := 'Prueba ' || gen_random_uuid();
  v_creator uuid;
  v_member uuid;
  v_movement uuid;
begin
  insert into public.finance_categories (name) values (v_category);
  insert into public.finance_movements (day, kind, category, amount)
    values (current_date, 'income', v_category, 14.80) returning id into v_movement;
  if (select updated_at from public.finance_movements where id = v_movement) is not null then
    raise exception 'Un movimiento nuevo no debe aparecer como actualizado';
  end if;
  perform public.finance_rename_category(v_category, v_category || ' renombrada');
  if not exists (select from public.finance_movements where id = v_movement
      and category = v_category || ' renombrada' and updated_at is not null and net is null) then
    raise exception 'Falta propagar el nombre, conservar el ingreso o marcar la edición';
  end if;
  delete from public.finance_categories where name = v_category || ' renombrada';
  if not exists (select from public.finance_movements where id = v_movement) then
    raise exception 'La baja de una categoría debe conservar los movimientos';
  end if;

  insert into public.finance_creators (name) values ('Modelo de prueba') returning id into v_creator;
  perform public.finance_save_member_share(null, null, v_category, 'Team Leader', current_date, 12.50, array[v_creator]);
  select id into strict v_member from public.finance_members where name = v_category;
  perform public.finance_save_member_share(v_member, null, v_category, 'Team Leader', current_date + 1, 20, array[v_creator]);
  if (select array_agg(percent order by effective_on) from public.finance_model_shares where member_id = v_member)
      is distinct from array[12.50, 20.00] then
    raise exception 'No se conservaron las vigencias';
  end if;
  begin
    perform public.finance_save_member_share(v_member, null, 'Nombre sin guardar', 'Team Leader', current_date + 2, 20, array[gen_random_uuid()]);
    raise exception 'Se aceptó un modelo inexistente';
  exception when check_violation then
    if not exists (select from public.finance_members where id = v_member and name = v_category) then
      raise exception 'Se guardó parcialmente una edición fallida';
    end if;
  end;
  perform public.finance_save_member_share(null, null, v_category || ' chatter', 'Chatter', current_date, 8, '{}');
  if not exists (
    select from public.finance_model_shares r join public.finance_members m on r.member_id = m.id
    where m.name = v_category || ' chatter' and r.percent = 8 and r.basis = 'employee_sales' and cardinality(r.creator_ids) = 0
  ) then
    raise exception 'El chatter debe cobrar sobre sus ventas sin asignar modelos';
  end if;
end;
$$;

select set_config('request.jwt.claims', '{"app_metadata":{"role":"chatter"}}', true);

do $$
begin
  if exists (select from public.finance_model_shares) then
    raise exception 'Los porcentajes están expuestos fuera del rol administrador';
  end if;
  begin
    perform public.finance_save_member_share(null, null, 'No autorizado', 'Chatter', current_date, 0, '{}');
    raise exception 'Un chatter pudo guardar un empleado';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claims', '{}', true);

do $$
declare
  test_member uuid;
  test_creator uuid;
  key_owner text := gen_random_uuid()::text;
  other_user text := gen_random_uuid()::text;
  creator_key text := gen_random_uuid()::text;
  catalog jsonb;
begin
  insert into public.finance_members (name, agencykey_id)
    values ('Chatter ficticio', other_user) returning id into test_member;
  insert into public.finance_creators (name, agencykey_id)
    values ('Modelo ficticio', creator_key) returning id into test_creator;
  catalog := jsonb_build_object('employees', jsonb_build_array(
    jsonb_build_object('id', key_owner, 'name', 'Dueño de prueba', 'role', 'Owner', 'active', true)),
    'creators', '[]'::jsonb);
  perform hers_private.apply_agencykey_directory(catalog);
  if exists (select from public.finance_members where id = test_member and agencykey_available)
    or exists (select from public.finance_creators where id = test_creator and agencykey_available)
    or not exists (select from public.finance_member_availability where member_id = test_member and not available) then
    raise exception 'No se reflejó la baja del directorio';
  end if;
  catalog := jsonb_set(catalog, '{employees,1}', jsonb_build_object(
    'id', other_user, 'name', 'Cuenta ficticia', 'role', 'Team Leader', 'active', true));
  catalog := jsonb_set(catalog, '{creators,0}', jsonb_build_object(
    'id', creator_key, 'name', 'Modelo renombrado'));
  perform hers_private.apply_agencykey_directory(catalog);
  if not exists (select from public.finance_members where id = test_member and agencykey_available and role = 'Team Leader')
    or not exists (select from public.finance_creators where id = test_creator and agencykey_available and name = 'Modelo renombrado') then
    raise exception 'No se restauró el estado o el nombre del directorio';
  end if;
  begin
    perform public.hers_agencykey_directory(repeat('0', 64), 'load');
    raise exception 'El RPC aceptó una credencial inválida';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
