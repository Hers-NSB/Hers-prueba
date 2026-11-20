create function public.finance_valid_distribution_shares(shares jsonb) returns boolean
language sql immutable strict set search_path = '' as $$
  select case when jsonb_typeof(shares) = 'object' then (
    select coalesce(bool_and(
      (key in ('dropper', 'hers') or key ~ '^(chatter|model):[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
      and jsonb_typeof(value) = 'number'
      and value::text ~ '^[1-9][0-9]{0,4}$'
    ), true)
    and coalesce(sum(case when value::text ~ '^[1-9][0-9]{0,4}$' then value::text::integer end), 0) <= 10000
    from jsonb_each(shares)
  ) else false end;
$$;

revoke all on function public.finance_valid_distribution_shares(jsonb) from public, anon, authenticated;
grant execute on function public.finance_valid_distribution_shares(jsonb) to authenticated;

create table public.finance_distribution_plans (
  effective_on date not null check (isfinite(effective_on)),
  revision integer not null check (revision > 0),
  shares jsonb not null check (public.finance_valid_distribution_shares(shares)),
  created_at timestamptz not null default now(),
  primary key (effective_on, revision)
);

alter table public.finance_distribution_plans enable row level security;
revoke all on table public.finance_distribution_plans from public, anon, authenticated;
grant select on table public.finance_distribution_plans to authenticated;
grant insert (effective_on, revision, shares) on table public.finance_distribution_plans to authenticated;

create policy finance_distribution_read on public.finance_distribution_plans for select to authenticated
using ((select public.finance_is_admin()));

create policy finance_distribution_insert on public.finance_distribution_plans for insert to authenticated
with check (
  (select public.finance_is_admin())
  and not exists (
    select from jsonb_object_keys(case when jsonb_typeof(shares) = 'object' then shares else '{}'::jsonb end) as beneficiary(ref)
    where ref not in ('dropper', 'hers')
      and not exists (select from public.finance_members m where 'chatter:' || m.id::text = ref)
      and not exists (select from public.finance_creators c where 'model:' || c.id::text = ref)
  )
);
