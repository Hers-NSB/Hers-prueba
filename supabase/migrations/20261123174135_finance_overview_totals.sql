create function public.finance_overview_totals() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with movement_totals as (
    select sum(net) filter (where kind = 'income') as net,
           sum(amount) filter (where kind <> 'income') as investment,
           jsonb_agg(distinct category order by category) as categories
      from public.finance_movements
  ), sales_totals as (
    select sum(net) as net from public.finance_agencykey_sales
  )
  select jsonb_build_object(
    'balance', case when m.net is not null or s.net is not null or m.investment is not null
      then coalesce(m.net, 0) + coalesce(s.net, 0) - coalesce(m.investment, 0)
    end,
    'movementCategories', coalesce(m.categories, '[]'::jsonb)
  )
  from movement_totals m cross join sales_totals s;
$$;

revoke all on function public.finance_overview_totals() from public, anon;
grant execute on function public.finance_overview_totals() to authenticated;

create index finance_model_shares_creator_id_idx on public.finance_model_shares (creator_id);
