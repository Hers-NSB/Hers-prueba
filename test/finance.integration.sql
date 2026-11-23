begin;

set local role service_role;
select public.finance_import_agencykey(
  '2020-01-01',
  '[{"creator_key":"finance-fixture-model","creator_name":"Modelo de prueba","gross":100,"net":80}]',
  '[{"creator_key":"finance-fixture-model","member_key":"finance-fixture-member","member_name":"Integrante de prueba","attributed":43.55}]'
);
select public.finance_import_agencykey(
  '2020-01-01',
  '[{"creator_key":"finance-fixture-model","creator_name":"Modelo de prueba","gross":100,"net":80}]',
  '[{"creator_key":"finance-fixture-model","member_key":"finance-fixture-member","member_name":"Integrante de prueba","attributed":43.55}]'
);
select public.finance_import_agencykey(
  '2020-01-02',
  '[{"creator_key":"finance-fixture-model","creator_name":"Modelo de prueba","crm_total":60}]',
  '[{"creator_key":"finance-fixture-model","member_key":"finance-fixture-member","member_name":"Integrante de prueba","attributed":40}]'
);
reset role;

set local role anon;
do $$
begin
  if has_table_privilege(current_user, 'public.finance_movements', 'select') or
     has_function_privilege(current_user, 'public.finance_overview_totals()', 'execute') or
     has_function_privilege(current_user, 'public.finance_import_agencykey(date,jsonb,jsonb)', 'execute') then
    raise exception 'Un visitante anónimo tiene acceso a Finanzas';
  end if;
end;
$$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","user_metadata":{"role":"admin"},"app_metadata":{"role":"chatter"}}';
do $$
begin
  if public.finance_is_admin()
     or exists (select 1 from public.finance_platforms)
     or exists (select 1 from public.finance_commissions)
     or public.finance_overview_totals() <> '{"balance": null, "movementCategories": []}'::jsonb
     or has_function_privilege(current_user, 'public.finance_import_agencykey(date,jsonb,jsonb)', 'execute') then
    raise exception 'Un chatter accedió a Finanzas';
  end if;
  begin
    insert into public.finance_creators(name) values ('No permitido');
    raise exception 'Un chatter escribió en Finanzas';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local request.jwt.claims = '{"role":"authenticated","app_metadata":{"role":"admin"}}';
do $$
declare member uuid;
declare model uuid;
declare platform uuid;
declare movement uuid;
declare prior_balance numeric := (public.finance_overview_totals()->>'balance')::numeric;
begin
  select id into strict member from public.finance_members where agencykey_id = 'finance-fixture-member';
  select id into strict model from public.finance_creators where agencykey_id = 'finance-fixture-model';
  insert into public.finance_platforms(name) values ('Plataforma de prueba') returning id into platform;
  insert into public.finance_creators(name) values ('Modelo manual de prueba');
  insert into public.finance_movements(day,kind,category,creator_id,platform_id,amount)
    values ('2020-01-01','expense','Servicios',model,platform,12.50) returning id into movement;
  update public.finance_movements set amount = 13.25 where id = movement;
  insert into public.finance_movements(day,kind,category,amount)
    values ('2020-01-01','investment','Equipos',25.00) returning id into movement;
  update public.finance_movements set category = 'Producción' where id = movement;
  insert into public.finance_movements(day,kind,category,creator_id,platform_id,amount,gross,net)
    values ('2020-01-01','income','Ventas',model,platform,40,100,80);
  insert into public.finance_rates values (member,'2020-01-01',10),(member,'2020-01-02',20);
  update public.finance_rates set percent = 25 where member_id = member and effective_on = '2020-01-02';

  if (public.finance_overview_totals()->>'balance')::numeric is distinct from coalesce(prior_balance, 0) + 41.75
     or not (public.finance_overview_totals()->'movementCategories' @> '["Producción","Servicios","Ventas"]'::jsonb)
     or not public.finance_is_admin()
     or (select count(*) from public.finance_agencykey_sales where creator_id = model) <> 2
     or (select count(*) from public.finance_commissions where member_id = member) <> 2
     or (select commission from public.finance_commissions where member_id = member and day = '2020-01-01') <> 4.36
     or (select commission from public.finance_commissions where member_id = member and day = '2020-01-02') <> 10
     or not exists (select 1 from public.finance_agencykey_sales where creator_id = model and day = '2020-01-02'
       and gross is null and net is null and crm_total = 60)
     or not exists (select 1 from public.finance_movements where platform_id = platform and kind = 'expense' and amount = 13.25)
     or not exists (select 1 from public.finance_movements where id = movement and category = 'Producción')
     or not exists (select 1 from public.finance_movements where platform_id = platform and kind = 'income' and amount = 40)
     or not exists (select 1 from public.finance_sync where source = 'agencykey' and through_day >= '2020-01-02') then
    raise exception 'Falló una aserción de Finanzas';
  end if;
end;
$$;

reset role;
rollback;
select 'Permisos, vigencias, movimientos e importación repetida OK' as resultado;
