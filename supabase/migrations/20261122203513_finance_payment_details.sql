-- Existing amounts are definitive. Historical sales and rates were not recorded on the cut.
alter table public.finance_payments
  add column net_sales numeric(16,2),
  add column pay_rate_min numeric(7,4),
  add column pay_rate_max numeric(7,4),
  add constraint finance_payments_rate_range check (
    (pay_rate_min is null and pay_rate_max is null)
    or (pay_rate_min is not null and pay_rate_max is not null
      and pay_rate_min >= 0 and pay_rate_max <= 100 and pay_rate_min <= pay_rate_max)
  );

create function hers_private.finance_period_pay_details(p_from date, p_to date)
returns table (member_id uuid, creator_id uuid, amount numeric, net_sales numeric, pay_rate_min numeric, pay_rate_max numeric)
language sql stable set search_path = '' as $$
  with days as (
    select p_from + n as day from generate_series(0, p_to - p_from) as n
  ), model_pay as (
    select null::uuid as member_id, s.creator_id, s.net as net, 100 - rate.percent as pay_rate
    from public.finance_agencykey_sales s
    cross join lateral (
      select r.percent from public.finance_model_shares r
      where r.creator_id = s.creator_id and r.member_id is null and r.effective_on <= s.day
      order by r.effective_on desc limit 1
    ) rate
    where s.day between p_from and p_to and s.net is not null
  ), chatter_pay as (
    select m.id as member_id, null::uuid as creator_id,
      coalesce((e.totals->>m.agencykey_id)::numeric, 0) as net, 100 - rate.percent as pay_rate
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
  select individual_pay.member_id, individual_pay.creator_id, round(sum(individual_pay.net * individual_pay.pay_rate / 100), 2),
    round(sum(individual_pay.net), 2), min(individual_pay.pay_rate), max(individual_pay.pay_rate)
  from individual_pay group by individual_pay.member_id, individual_pay.creator_id;
$$;

revoke all on function hers_private.finance_period_pay_details(date,date) from public, anon, authenticated;

create or replace function hers_private.finance_period_pay(p_from date, p_to date)
returns table (member_id uuid, creator_id uuid, amount numeric)
language sql stable set search_path = '' as $$
  select p.member_id, p.creator_id, p.amount
  from hers_private.finance_period_pay_details(p_from, p_to) p;
$$;

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

create or replace function public.hers_payroll_worker(p_token text, p_action text, p_data jsonb default '{}') returns jsonb
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

    insert into public.finance_payments (period_start, period_end, member_id, creator_id, amount, net_sales, pay_rate_min, pay_rate_max)
    select period_start, period_end, p.member_id, p.creator_id, p.amount, p.net_sales, p.pay_rate_min, p.pay_rate_max
      from hers_private.finance_period_pay_details(period_start, period_end) p
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
