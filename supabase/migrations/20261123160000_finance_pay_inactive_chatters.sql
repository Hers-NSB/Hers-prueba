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
    -- Las ventas atribuidas generan comisión aunque el directorio marque al chatter como inactivo.
    where e.day between p_from and p_to and rate.basis = 'employee_sales'
      and (coalesce(status.available, true) or e.totals ? m.agencykey_id)
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
