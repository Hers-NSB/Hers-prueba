alter table public.finance_categories
  add column description text not null default '' check (char_length(description) <= 500);

create function public.finance_update_category(p_name text, p_new_name text, p_description text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_name <> btrim(p_new_name) then
    perform public.finance_rename_category(p_name, p_new_name);
  end if;

  update public.finance_categories
    set description = btrim(coalesce(p_description, ''))
    where name = btrim(p_new_name);
  if not found then
    raise no_data_found using message = 'La categoría ya no está disponible';
  end if;
end;
$$;

revoke all on function public.finance_update_category(text, text, text) from public, anon;
grant execute on function public.finance_update_category(text, text, text) to authenticated;

create function hers_private.finance_assigned_model_pay(p_from date, p_to date)
returns table (day date, member_id uuid, net numeric, pay_rate numeric, amount numeric)
language sql stable set search_path = '' as $$
  -- The daily net for each assigned model is unique and each assignment is validated on save.
  select d.day, m.id, sum(s.net), rate.percent, sum(round(s.net * rate.percent / 100, 2))
  from (select p_from + n as day from generate_series(0, p_to - p_from) as n) d
  join public.finance_members m on m.archived_on is null or m.archived_on > d.day
  cross join lateral (
    select r.basis, r.percent, r.creator_ids
    from public.finance_model_shares r
    where r.member_id = m.id and r.effective_on <= d.day
    order by r.effective_on desc limit 1
  ) rate
  left join lateral (
    select a.available from public.finance_member_availability a
    where a.member_id = m.id and a.effective_on <= d.day
    order by a.effective_on desc limit 1
  ) status on true
  join public.finance_agencykey_sales s on s.day = d.day and s.creator_id = any(rate.creator_ids)
  where rate.basis = 'model_sales' and coalesce(status.available, true) and s.net is not null
  group by d.day, m.id, rate.percent;
$$;

revoke all on function hers_private.finance_assigned_model_pay(date, date) from public, anon, authenticated;

create or replace function hers_private.finance_period_pay_details(p_from date, p_to date)
returns table (member_id uuid, creator_id uuid, amount numeric, net_sales numeric, pay_rate_min numeric, pay_rate_max numeric)
language sql stable set search_path = '' as $$
  with model_pay as (
    select null::uuid as member_id, s.creator_id, s.net, rate.percent as pay_rate, s.net * rate.percent / 100 as amount
    from public.finance_agencykey_sales s
    cross join lateral (
      select r.percent from public.finance_model_shares r
      where r.creator_id = s.creator_id and r.member_id is null and r.effective_on <= s.day
      order by r.effective_on desc limit 1
    ) rate
    where s.day between p_from and p_to and s.net is not null
  ), employee_sales as (
    select m.id as member_id, coalesce((e.totals->>m.agencykey_id)::numeric, 0) as net, rate.percent as pay_rate
    from public.finance_agencykey_employee_net e
    join public.finance_members m on m.agencykey_id is not null and (m.archived_on is null or m.archived_on > e.day)
    cross join lateral (
      select r.percent, r.basis from public.finance_model_shares r
      where r.member_id = m.id and r.effective_on <= e.day
      order by r.effective_on desc limit 1
    ) rate
    left join lateral (
      select a.available from public.finance_member_availability a
      where a.member_id = m.id and a.effective_on <= e.day
      order by a.effective_on desc limit 1
    ) status on true
    where e.day between p_from and p_to and rate.basis = 'employee_sales' and coalesce(status.available, true)
  ), individual_pay as (
    select * from model_pay
    union all
    select e.member_id, null::uuid, e.net, e.pay_rate, e.net * e.pay_rate / 100 from employee_sales e
    union all
    select p.member_id, null::uuid, p.net, p.pay_rate, p.amount
    from hers_private.finance_assigned_model_pay(p_from, p_to) p
  )
  select p.member_id, p.creator_id, round(sum(p.amount), 2), round(sum(p.net), 2), min(p.pay_rate), max(p.pay_rate)
  from individual_pay p group by p.member_id, p.creator_id;
$$;

create or replace function public.finance_current_pay() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  today date;
  period_start date;
  period_end date;
  amounts jsonb;
  sales jsonb;
  imported_days integer;
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
  ) into amounts
  from hers_private.finance_period_pay(period_start, today) p;

  -- Imported sales remain visible without a payment rate and after a directory deactivation.
  select jsonb_object_agg(recipient, net) into sales
  from (
    select recipient, sum(net) as net
    from (
      select 'model:' || s.creator_id as recipient, s.net
      from public.finance_agencykey_sales s
      where s.day between period_start and today and s.net is not null
      union all
      select 'chatter:' || m.id, (e.totals->>m.agencykey_id)::numeric
      from public.finance_agencykey_employee_net e
      join public.finance_members m on e.totals ? m.agencykey_id
        and (m.archived_on is null or m.archived_on > e.day)
      left join lateral (
        select r.basis from public.finance_model_shares r
        where r.member_id = m.id and r.effective_on <= e.day
        order by r.effective_on desc limit 1
      ) rate on true
      where e.day between period_start and today and rate.basis is distinct from 'model_sales'
      union all
      select 'chatter:' || p.member_id, p.net
      from hers_private.finance_assigned_model_pay(period_start, today) p
    ) imported_sales
    group by recipient
  ) totals;

  select count(*) into imported_days from hers_private.finance_final_days
    where day between period_start and today - 1;

  return jsonb_build_object(
    'day', today, 'from', period_start, 'to', period_end,
    'amounts', coalesce(amounts, '{}'), 'sales', coalesce(sales, '{}'),
    'importedDays', imported_days, 'totalDays', period_end - period_start + 1
  );
end;
$$;

create function public.finance_save_current_pay_rate(
  p_member_id uuid, p_creator_id uuid, p_name text, p_role text, p_percent numeric, p_creator_ids uuid[]
) returns void language plpgsql set search_path = '' as $$
declare
  current_pay jsonb;
  period_start date;
  period_end date;
begin
  if auth.uid() is null or not public.finance_is_admin() then
    raise insufficient_privilege;
  end if;
  if p_member_id is not null and p_creator_id is not null then
    raise invalid_parameter_value;
  end if;

  -- Serialize saves for the same recipient before updating the start and later versions of the rate.
  if coalesce(p_member_id, p_creator_id) is not null then
    perform pg_advisory_xact_lock(hashtextextended('finance-rate:' || coalesce(p_member_id, p_creator_id), 0));
  end if;
  current_pay := public.finance_current_pay();
  period_start := (current_pay->>'from')::date;
  period_end := (current_pay->>'to')::date;

  if p_creator_id is null then
    perform public.finance_save_member_share(p_member_id, null, p_name, p_role, period_start, p_percent, p_creator_ids);
  else
    insert into public.finance_model_shares (creator_id, effective_on, percent)
      values (p_creator_id, period_start, p_percent)
      on conflict (member_id, creator_id, effective_on) do update set percent = excluded.percent;
  end if;

  if coalesce(p_member_id, p_creator_id) is not null then
    update public.finance_model_shares r
      set percent = first_rate.percent, basis = first_rate.basis, creator_ids = first_rate.creator_ids
      from public.finance_model_shares first_rate
      where first_rate.effective_on = period_start
        and (first_rate.member_id = p_member_id or first_rate.creator_id = p_creator_id)
        and r.member_id is not distinct from first_rate.member_id and r.creator_id is not distinct from first_rate.creator_id
        and r.effective_on > period_start and r.effective_on <= period_end
        and (r.percent, r.basis, r.creator_ids) is distinct from (first_rate.percent, first_rate.basis, first_rate.creator_ids);
  end if;
end;
$$;

revoke all on function public.finance_save_current_pay_rate(uuid, uuid, text, text, numeric, uuid[]) from public, anon;
grant execute on function public.finance_save_current_pay_rate(uuid, uuid, text, text, numeric, uuid[]) to authenticated;
