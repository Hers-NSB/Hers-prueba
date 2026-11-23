create or replace function hers_private.finance_period_pay_details(p_from date, p_to date)
returns table (member_id uuid, creator_id uuid, amount numeric, net_sales numeric, pay_rate_min numeric, pay_rate_max numeric)
language sql stable set search_path = '' as $$
  with days as (
    select p_from + n as day from generate_series(0, p_to - p_from) as n
  ), model_pay as (
    select null::uuid as member_id, s.creator_id, s.net as net, rate.percent as pay_rate
    from public.finance_agencykey_sales s
    cross join lateral (
      select r.percent from public.finance_model_shares r
      where r.creator_id = s.creator_id and r.member_id is null and r.effective_on <= s.day
      order by r.effective_on desc limit 1
    ) rate
    where s.day between p_from and p_to and s.net is not null
  ), chatter_pay as (
    select m.id as member_id, null::uuid as creator_id,
      coalesce((e.totals->>m.agencykey_id)::numeric, 0) as net, rate.percent as pay_rate
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
