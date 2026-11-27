alter table public.finance_model_shares
  add column chatter_ids uuid[] not null default '{}',
  add column chatter_percent numeric(5,2) not null default 0,
  add constraint finance_chatter_share_valid check (
    chatter_percent between 0 and 100 and
    (member_id is not null or cardinality(chatter_ids) = 0 and chatter_percent = 0) and
    (chatter_percent = 0 or cardinality(chatter_ids) > 0) and
    array_position(chatter_ids, null) is null
  );

create function hers_private.finance_assigned_chatter_pay(p_from date, p_to date)
returns table (member_id uuid, net numeric, pay_rate numeric, amount numeric)
language sql stable set search_path = '' as $$
  select recipient.id, sums.net, rate.chatter_percent, sums.net * rate.chatter_percent / 100
  from public.finance_agencykey_employee_net e
  join public.finance_members recipient on recipient.archived_on is null or recipient.archived_on > e.day
  cross join lateral (
    select r.chatter_ids, r.chatter_percent from public.finance_model_shares r
    where r.member_id = recipient.id and r.effective_on <= e.day
    order by r.effective_on desc limit 1
  ) rate
  left join lateral (
    select a.available from public.finance_member_availability a
    where a.member_id = recipient.id and a.effective_on <= e.day
    order by a.effective_on desc limit 1
  ) status on true
  cross join lateral (
    select sum((e.totals->>chatter.agencykey_id)::numeric) as net
    from public.finance_members chatter
    where chatter.id = any(rate.chatter_ids) and e.totals ? chatter.agencykey_id
  ) sums
  where e.day between p_from and p_to and cardinality(rate.chatter_ids) > 0
    and coalesce(status.available, true) and sums.net is not null;
$$;

revoke all on function hers_private.finance_assigned_chatter_pay(date, date) from public, anon, authenticated;

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
    union all
    select p.member_id, null::uuid, p.net, p.pay_rate, p.amount
    from hers_private.finance_assigned_chatter_pay(p_from, p_to) p
  )
  select p.member_id, p.creator_id, round(sum(p.amount)), round(sum(p.net), 2), min(p.pay_rate), max(p.pay_rate)
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
      union all
      select 'chatter:' || p.member_id, p.net
      from hers_private.finance_assigned_chatter_pay(period_start, today) p
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

create function public.finance_save_current_member_pay(
  p_member_id uuid, p_name text, p_role text, p_percent numeric, p_creator_ids uuid[],
  p_chatter_percent numeric, p_chatter_ids uuid[]
) returns void language plpgsql set search_path = '' as $$
declare
  member_key uuid := p_member_id;
  current_period jsonb;
  period_start date;
  period_end date;
  selected_chatters uuid[] := coalesce(p_chatter_ids, '{}'::uuid[]);
begin
  if auth.uid() is null or not public.finance_is_admin() then
    raise insufficient_privilege;
  end if;

  if p_chatter_percent is null or p_chatter_percent not between 0 and 100
    or (p_chatter_percent > 0 and cardinality(selected_chatters) = 0)
    or cardinality(selected_chatters) <> (select count(distinct id) from unnest(selected_chatters) as ids(id))
    or exists (
      select 1 from unnest(selected_chatters) as ids(id)
      where not exists (
        select 1 from public.finance_members m where m.id = ids.id
          and m.id is distinct from member_key and m.agencykey_id is not null
          and m.role ~* '(^|,) *chatters? *(,|$)'
      )
    ) then
    raise invalid_parameter_value using message = 'Selecciona chatters vinculados a AgencyKey y un porcentaje válido';
  end if;

  current_period := public.finance_current_pay();
  period_start := (current_period->>'from')::date;
  period_end := (current_period->>'to')::date;

  if member_key is null then
    insert into public.finance_members (name, role) values (btrim(p_name), btrim(p_role))
      returning id into member_key;
  end if;
  perform public.finance_save_current_pay_rate(member_key, null, p_name, p_role, p_percent, p_creator_ids);

  update public.finance_model_shares r
    set chatter_ids = selected_chatters, chatter_percent = p_chatter_percent
    where r.member_id = member_key and r.effective_on between period_start and period_end;
end;
$$;

revoke all on function public.finance_save_current_member_pay(uuid, text, text, numeric, uuid[], numeric, uuid[]) from public, anon;
grant execute on function public.finance_save_current_member_pay(uuid, text, text, numeric, uuid[], numeric, uuid[]) to authenticated;
