alter table public.finance_payments
  add column deleted_member_id uuid,
  add column deleted_member_name text,
  drop constraint finance_payments_check1,
  drop constraint finance_payments_period_start_member_id_creator_id_key,
  add constraint finance_payments_one_recipient check (
    num_nonnulls(member_id, creator_id, deleted_member_id) = 1
    and (deleted_member_id is null) = (deleted_member_name is null)
  ),
  add constraint finance_payments_period_recipient_key
    unique nulls not distinct (period_start, member_id, creator_id, deleted_member_id);

create index finance_payments_deleted_member
  on public.finance_payments (deleted_member_id, period_start desc)
  where deleted_member_id is not null;

create function public.finance_delete_manual_member(p_member_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  member_name text;
begin
  if auth.uid() is null or not public.finance_is_admin() then
    raise insufficient_privilege;
  end if;

  -- Wait for any payroll close already writing cuts for this employee.
  perform from hers_private.finance_payroll for update;
  select name into member_name from public.finance_members
    where id = p_member_id and agencykey_id is null for update;
  if not found then
    raise invalid_parameter_value using message = 'El empleado manual no está disponible para eliminar';
  end if;

  update public.finance_payments
    set deleted_member_id = p_member_id, deleted_member_name = member_name, member_id = null
    where member_id = p_member_id;

  delete from public.finance_model_shares where member_id = p_member_id;
  delete from public.finance_rates where member_id = p_member_id;
  delete from public.finance_agencykey_attributions where member_id = p_member_id;
  delete from public.finance_member_availability where member_id = p_member_id;
  delete from public.finance_members where id = p_member_id;
end;
$$;

revoke all on function public.finance_delete_manual_member(uuid) from public, anon;
grant execute on function public.finance_delete_manual_member(uuid) to authenticated;

create or replace function hers_private.finance_post_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  zone text;
  recipient text;
  payment_category text := case when new.creator_id is null then 'Equipo' else 'Modelo' end;
begin
  select report_zone into zone from hers_private.finance_payroll;
  if new.creator_id is not null then
    select name into recipient from public.finance_creators where id = new.creator_id;
  elsif new.deleted_member_id is not null then
    recipient := new.deleted_member_name;
  else
    select name into recipient from public.finance_members where id = new.member_id;
  end if;

  insert into public.finance_categories (name) values (payment_category) on conflict do nothing;
  insert into public.finance_movements (day, kind, category, description, creator_id, amount, finance_payment_id)
  values ((new.paid_at at time zone zone)::date, 'investment', payment_category,
    concat(recipient, ' · ', new.period_start, ' a ', new.period_end),
    new.creator_id, new.amount, new.id);
  return new;
end;
$$;

create or replace function public.finance_save_member_share(
  p_member_id uuid, p_agencykey_id text, p_name text, p_role text,
  p_effective_on date, p_percent numeric, p_creator_ids uuid[]
) returns void language plpgsql set search_path = '' as $$
declare
  member_key uuid;
  member_role text;
  linked_account text;
  share_basis text;
begin
  if p_member_id is not null then
    update public.finance_members
      set name = case when agencykey_id is null then btrim(p_name) else name end,
          role = case when agencykey_id is null then btrim(p_role) else role end
      where id = p_member_id and archived_on is null returning id, role, agencykey_id into member_key, member_role, linked_account;
  elsif p_agencykey_id is not null then
    insert into public.finance_members (agencykey_id, name, role)
    values (p_agencykey_id, btrim(p_name), btrim(p_role))
    on conflict (agencykey_id) do update set name = excluded.name, role = excluded.role, archived_on = null
    returning id, role, agencykey_id into member_key, member_role, linked_account;
  else
    insert into public.finance_members (name, role) values (btrim(p_name), btrim(p_role))
    returning id, role, agencykey_id into member_key, member_role, linked_account;
  end if;

  share_basis := case when member_role ~* '(^|,) *chatters? *(,|$)'
    and (linked_account is not null or (p_percent > 0 and cardinality(p_creator_ids) = 0))
    then 'employee_sales' else 'model_sales' end;
  insert into public.finance_model_shares (member_id, effective_on, percent, creator_ids, basis)
    values (member_key, p_effective_on, p_percent,
      case when share_basis = 'employee_sales' then '{}'::uuid[] else p_creator_ids end, share_basis)
    on conflict (member_id, creator_id, effective_on) do update
    set percent = excluded.percent, creator_ids = excluded.creator_ids, basis = excluded.basis;
end;
$$;
