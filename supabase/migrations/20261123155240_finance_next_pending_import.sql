create or replace function public.hers_payroll_worker(p_token text, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  today date;
  zone text;
  period_start date;
  period_end date;
  final_day date;
  after_day date;
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
    after_day := (p_data->>'after_day')::date;
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
    where (after_day is null or period_start + n > after_day)
      and not exists (select from hers_private.finance_final_days where day = period_start + n);
  return jsonb_build_object('day', final_day);
end;
$$;
