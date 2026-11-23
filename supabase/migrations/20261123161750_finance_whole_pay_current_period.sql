create or replace function hers_private.finance_assigned_model_pay(p_from date, p_to date)
returns table (day date, member_id uuid, net numeric, pay_rate numeric, amount numeric)
language sql stable set search_path = '' as $$
  -- The daily net for each assigned model is unique and each assignment is validated on save.
  select d.day, m.id, sum(s.net), rate.percent, sum(s.net * rate.percent / 100)
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
    where e.day between p_from and p_to and rate.basis = 'employee_sales'
      -- A directory deactivation does not cancel sales attributed to a chatter.
      and (coalesce(status.available, true) or e.totals ? m.agencykey_id)
  ), individual_pay as (
    select * from model_pay
    union all
    select e.member_id, null::uuid, e.net, e.pay_rate, e.net * e.pay_rate / 100 from employee_sales e
    union all
    select p.member_id, null::uuid, p.net, p.pay_rate, p.amount
    from hers_private.finance_assigned_model_pay(p_from, p_to) p
  )
  select p.member_id, p.creator_id, round(sum(p.amount)), round(sum(p.net), 2), min(p.pay_rate), max(p.pay_rate)
  from individual_pay p group by p.member_id, p.creator_id;
$$;

-- Normalize rates saved before the application started saving them for the entire period.
do $$
declare
  report_day date;
  period_start date;
  period_end date;
begin
  lock table public.finance_model_shares in share row exclusive mode;

  select (statement_timestamp() at time zone report_zone)::date
    into report_day from hers_private.finance_payroll;
  period_start := public.finance_pay_period_start(report_day);
  period_end := case when extract(day from period_start) = 1 then period_start + 14
    else (date_trunc('month', period_start) + interval '1 month')::date - 1 end;

  with latest as materialized (
    select distinct on (member_id, creator_id) member_id, creator_id, effective_on, percent, basis, creator_ids
    from public.finance_model_shares
    where effective_on <= report_day
    order by member_id, creator_id, effective_on desc
  ), at_start as (
    insert into public.finance_model_shares (member_id, creator_id, effective_on, percent, basis, creator_ids)
    select member_id, creator_id, period_start, percent, basis, creator_ids
    from latest where effective_on > period_start
    on conflict (member_id, creator_id, effective_on) do update
      set percent = excluded.percent, basis = excluded.basis, creator_ids = excluded.creator_ids
  )
  update public.finance_model_shares r
    set percent = latest.percent, basis = latest.basis, creator_ids = latest.creator_ids
    from latest
    where r.member_id is not distinct from latest.member_id and r.creator_id is not distinct from latest.creator_id
      and r.effective_on > period_start and r.effective_on <= period_end
      and (r.percent, r.basis, r.creator_ids) is distinct from (latest.percent, latest.basis, latest.creator_ids);
end;
$$;
