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

  -- Imported sales are visible even when the recipient has no payment rate yet.
  select jsonb_object_agg(recipient, net) into sales
  from (
    select 'model:' || s.creator_id as recipient, sum(s.net) as net
    from public.finance_agencykey_sales s
    where s.day between period_start and today and s.net is not null
    group by s.creator_id
    union all
    select 'chatter:' || m.id, sum((e.totals->>m.agencykey_id)::numeric)
    from public.finance_agencykey_employee_net e
    join public.finance_members m on e.totals ? m.agencykey_id
      and (m.archived_on is null or m.archived_on > e.day)
    where e.day between period_start and today
    group by m.id
  ) imported_sales;

  select count(*) into imported_days from hers_private.finance_final_days
    where day between period_start and today - 1;

  return jsonb_build_object(
    'day', today, 'from', period_start, 'to', period_end,
    'amounts', coalesce(amounts, '{}'), 'sales', coalesce(sales, '{}'),
    'importedDays', imported_days, 'totalDays', period_end - period_start + 1
  );
end;
$$;
