create function public.finance_pay_period_start(p_day date) returns date
language sql immutable strict set search_path = '' as $$
  select make_date(extract(year from p_day)::int, extract(month from p_day)::int,
    case when extract(day from p_day) <= 15 then 1 else 16 end);
$$;

create table hers_private.finance_payroll (
  singleton boolean primary key default true check (singleton),
  next_period date not null,
  report_zone text not null default 'America/Halifax'
);
insert into hers_private.finance_payroll (next_period)
values (public.finance_pay_period_start((statement_timestamp() at time zone 'America/Halifax')::date));

create table hers_private.finance_final_days (day date primary key);

create table public.finance_payments (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  member_id uuid references public.finance_members,
  creator_id uuid references public.finance_creators,
  amount numeric(16,2) not null,
  paid_at timestamptz,
  paid_by uuid,
  check (num_nonnulls(member_id, creator_id) = 1),
  check ((paid_at is null) = (paid_by is null)),
  unique nulls not distinct (period_start, member_id, creator_id)
);
create index finance_payments_member on public.finance_payments (member_id, period_start desc);
create index finance_payments_creator on public.finance_payments (creator_id, period_start desc);
alter table public.finance_payments enable row level security;
revoke all on public.finance_payments from public, anon, authenticated;
grant select, update (paid_at, paid_by) on public.finance_payments to authenticated;
create policy finance_payments_read on public.finance_payments for select to authenticated
  using ((select public.finance_is_admin()));
create policy finance_payments_confirm on public.finance_payments for update to authenticated
  using ((select public.finance_is_admin()) and paid_at is null and amount > 0)
  with check ((select public.finance_is_admin()) and paid_at = statement_timestamp() and paid_by = (select auth.uid()));

alter table public.finance_movements
  add column finance_payment_id uuid unique references public.finance_payments,
  add constraint finance_payment_movement_kind check (finance_payment_id is null or kind = 'investment');

revoke insert, update on public.finance_movements from authenticated;
grant insert (id, day, kind, category, description, creator_id, platform_id, amount, gross, net, updated_at),
      update (id, day, kind, category, description, creator_id, platform_id, amount, gross, net, updated_at)
  on public.finance_movements to authenticated;

create function hers_private.finance_protect_payment_movement() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.finance_payment_id is not null
     and (new.id, new.day, new.kind, new.description, new.creator_id, new.platform_id, new.amount, new.gross, new.net, new.finance_payment_id)
         is distinct from
         (old.id, old.day, old.kind, old.description, old.creator_id, old.platform_id, old.amount, old.gross, old.net, old.finance_payment_id) then
    raise check_violation using message = 'El importe y los datos del pago confirmado son definitivos';
  end if;
  return new;
end;
$$;

create trigger finance_protect_payment_movement before update on public.finance_movements
for each row execute function hers_private.finance_protect_payment_movement();

create function hers_private.finance_post_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  zone text;
  recipient text;
  payment_category text := 'Pago de personal';
begin
  select report_zone into zone from hers_private.finance_payroll;
  if new.creator_id is not null then
    select name into recipient from public.finance_creators where id = new.creator_id;
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

create trigger finance_post_payment after update of paid_at on public.finance_payments
for each row when (old.paid_at is null and new.paid_at is not null)
execute function hers_private.finance_post_payment();

revoke all on function hers_private.finance_protect_payment_movement(), hers_private.finance_post_payment()
  from public, anon, authenticated;

create function public.finance_confirm_payment(p_id uuid) returns boolean
language sql set search_path = '' as $$
  with confirmed as (
    update public.finance_payments
    set paid_at = statement_timestamp(), paid_by = auth.uid()
    where id = p_id and paid_at is null
    returning id
  )
  select exists (select from confirmed);
$$;

create function hers_private.finance_period_pay(p_from date, p_to date)
returns table (member_id uuid, creator_id uuid, amount numeric)
language sql stable set search_path = '' as $$
  with days as (
    select p_from + n as day from generate_series(0, p_to - p_from) as n
  ), model_pay as (
    select null::uuid as member_id, s.creator_id, s.net * (100 - rate.percent) / 100 as amount
    from public.finance_agencykey_sales s
    cross join lateral (
      select r.percent from public.finance_model_shares r
      where r.creator_id = s.creator_id and r.member_id is null and r.effective_on <= s.day
      order by r.effective_on desc limit 1
    ) rate
    where s.day between p_from and p_to and s.net is not null
  ), chatter_pay as (
    select m.id as member_id, null::uuid as creator_id,
      coalesce((e.totals->>m.agencykey_id)::numeric, 0) * (100 - rate.percent) / 100 as amount
    from days d
    join public.finance_agencykey_employee_net e on e.day = d.day
    join public.finance_members m on m.agencykey_id is not null and (m.archived_on is null or m.archived_on > d.day)
    cross join lateral (
      select r.percent, r.basis from public.finance_model_shares r
      where r.member_id = m.id and r.effective_on <= d.day
      order by r.effective_on desc limit 1
    ) rate
    left join lateral (
      select a.available from public.finance_member_availability a
      where a.member_id = m.id and a.effective_on <= d.day
      order by a.effective_on desc limit 1
    ) status on true
    where rate.basis = 'employee_sales' and coalesce(status.available, true)
  ), individual_pay as (
    select * from model_pay union all select * from chatter_pay
  )
  select individual_pay.member_id, individual_pay.creator_id, round(sum(individual_pay.amount), 2)
  from individual_pay group by individual_pay.member_id, individual_pay.creator_id;
$$;

create function public.finance_current_pay() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  today date;
  period_start date;
  period_end date;
  amounts jsonb;
begin
  if auth.uid() is null or not public.finance_is_admin() then
    raise insufficient_privilege;
  end if;
  select (statement_timestamp() at time zone report_zone)::date into today from hers_private.finance_payroll;
  period_start := public.finance_pay_period_start(today);
  period_end := case when extract(day from period_start) = 1 then period_start + 14
    else (date_trunc('month', period_start) + interval '1 month')::date - 1 end;
  select jsonb_object_agg(
    case when p.member_id is null then 'model:' || p.creator_id else 'chatter:' || p.member_id end, p.amount
  ) into amounts from hers_private.finance_period_pay(period_start, today) p;
  return jsonb_build_object('day', today, 'from', period_start, 'to', period_end, 'amounts', coalesce(amounts, '{}'));
end;
$$;

create function public.hers_payroll_worker(p_token text, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  today date;
  zone text;
  period_start date;
  period_end date;
  final_day date;
begin
  if p_token is null or length(p_token) <> 64 or not exists (
    select from hers_private.integration_backend where token_hash = sha256(convert_to(p_token, 'UTF8'))
  ) then
    raise insufficient_privilege;
  end if;

  select next_period, report_zone into period_start, zone from hers_private.finance_payroll for update;
  zone := coalesce(p_data->>'report_zone', zone);
  today := (statement_timestamp() at time zone zone)::date;
  if p_action = 'next' then
    update hers_private.finance_payroll set report_zone = zone where report_zone <> zone;
  elsif p_action = 'import' then
    final_day := (p_data->>'p_day')::date;
    if final_day is null or final_day >= today then raise invalid_parameter_value; end if;
    if not exists (select from hers_private.finance_final_days where day = final_day) then
      perform public.hers_integration_worker(p_token, 'import', p_data);
      insert into hers_private.finance_final_days values (final_day);
    end if;
  else
    raise invalid_parameter_value;
  end if;

  loop
    period_end := case when extract(day from period_start) = 1 then period_start + 14
      else (date_trunc('month', period_start) + interval '1 month')::date - 1 end;
    exit when period_end >= today or (
      select count(*) from hers_private.finance_final_days where day between period_start and period_end
    ) <> period_end - period_start + 1;

    insert into public.finance_payments (period_start, period_end, member_id, creator_id, amount)
    select period_start, period_end, p.member_id, p.creator_id, p.amount
      from hers_private.finance_period_pay(period_start, period_end) p
      on conflict do nothing;
    period_start := period_end + 1;
    update hers_private.finance_payroll set next_period = period_start;
  end loop;

  select min(period_start + n) into final_day
    from generate_series(0, least(period_end, today - 1) - period_start) as n
    where not exists (select from hers_private.finance_final_days where day = period_start + n);
  return jsonb_build_object('day', final_day);
end;
$$;

revoke all on function public.finance_confirm_payment(uuid), public.finance_current_pay(),
  public.hers_payroll_worker(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.finance_confirm_payment(uuid), public.finance_current_pay() to authenticated;
grant execute on function public.hers_payroll_worker(text,text,jsonb) to anon;
revoke all on function hers_private.finance_period_pay(date,date) from public, anon, authenticated;
revoke all on hers_private.finance_payroll, hers_private.finance_final_days from public, anon, authenticated;

alter function hers_private.apply_agencykey_directory(jsonb) rename to update_existing_agencykey_directory;
create function hers_private.apply_agencykey_directory(p_snapshot jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  perform hers_private.update_existing_agencykey_directory(p_snapshot);
  insert into public.finance_members (agencykey_id, name, role)
  select id, name, role
    from jsonb_to_recordset(p_snapshot->'employees') as member(id text, name text, role text, active boolean)
    where active and role ~* '(^|,) *chatters? *(,|$)'
  on conflict (agencykey_id) do nothing;
end;
$$;
revoke all on function hers_private.apply_agencykey_directory(jsonb) from public, anon, authenticated;
