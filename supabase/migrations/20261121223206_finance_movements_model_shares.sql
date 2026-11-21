alter table public.finance_movements
  add column updated_at timestamptz,
  drop constraint finance_movements_amounts,
  add constraint finance_movements_amounts check (
    kind = 'income' or (amount > 0 and gross is null and net is null)
  );

create function public.finance_mark_movement_updated() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.day, new.kind, new.category, new.description, new.creator_id, new.platform_id, new.amount, new.gross, new.net)
    is distinct from
    (old.day, old.kind, old.category, old.description, old.creator_id, old.platform_id, old.amount, old.gross, old.net) then
    new.updated_at := statement_timestamp();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create trigger finance_movement_updated before update on public.finance_movements
for each row execute function public.finance_mark_movement_updated();

grant update, delete on public.finance_categories to authenticated;

create function public.finance_rename_category(p_name text, p_new_name text) returns void
language plpgsql set search_path = '' as $$
begin
  update public.finance_categories set name = btrim(p_new_name) where name = p_name;
  if not found then
    raise exception 'La categoría ya no está disponible' using errcode = 'P0002';
  end if;
  update public.finance_movements set category = btrim(p_new_name) where lower(category) = lower(p_name);
end;
$$;

revoke all on function public.finance_rename_category(text, text) from public, anon;
grant execute on function public.finance_rename_category(text, text) to authenticated;

create table public.finance_model_shares (
  id uuid primary key default gen_random_uuid(),
  effective_on date not null,
  member_id uuid references public.finance_members,
  creator_id uuid references public.finance_creators,
  creator_ids uuid[] not null default '{}',
  percent numeric(5,2) not null check (percent between 0 and 100),
  check (num_nonnulls(member_id, creator_id) = 1),
  check (creator_id is null or cardinality(creator_ids) = 0),
  check (member_id is null or percent = 0 or cardinality(creator_ids) > 0),
  unique nulls not distinct (member_id, creator_id, effective_on)
);

alter table public.finance_model_shares enable row level security;
revoke all on public.finance_model_shares from public, anon, authenticated;
grant select, insert, update on public.finance_model_shares to authenticated;
create policy finance_model_shares_read on public.finance_model_shares for select to authenticated
  using ((select public.finance_is_admin()));
create policy finance_model_shares_insert on public.finance_model_shares for insert to authenticated
  with check ((select public.finance_is_admin()));
create policy finance_model_shares_update on public.finance_model_shares for update to authenticated
  using ((select public.finance_is_admin())) with check ((select public.finance_is_admin()));

create function public.finance_check_share_creators() returns trigger
language plpgsql set search_path = '' as $$
begin
  if cardinality(new.creator_ids) <> (
    select count(*) from public.finance_creators where id = any(new.creator_ids)
  ) then
    raise exception 'La lista de modelos contiene entradas inválidas o duplicadas' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger finance_share_creators before insert or update on public.finance_model_shares
for each row execute function public.finance_check_share_creators();

create function public.finance_save_member_share(
  p_member_id uuid, p_agencykey_id text, p_name text, p_role text,
  p_effective_on date, p_percent numeric, p_creator_ids uuid[]
) returns void language plpgsql set search_path = '' as $$
declare member_key uuid;
begin
  if p_member_id is not null then
    update public.finance_members
      set name = case when agencykey_id is null then btrim(p_name) else name end,
          role = case when agencykey_id is null then btrim(p_role) else role end
      where id = p_member_id and archived_on is null returning id into member_key;
  elsif p_agencykey_id is not null then
    insert into public.finance_members (agencykey_id, name, role)
    values (p_agencykey_id, btrim(p_name), btrim(p_role))
    on conflict (agencykey_id) do update set name = excluded.name, role = excluded.role, archived_on = null
    returning id into member_key;
  else
    insert into public.finance_members (name, role) values (btrim(p_name), btrim(p_role))
    returning id into member_key;
  end if;

  insert into public.finance_model_shares (member_id, effective_on, percent, creator_ids)
    values (member_key, p_effective_on, p_percent, p_creator_ids)
    on conflict (member_id, creator_id, effective_on) do update
    set percent = excluded.percent, creator_ids = excluded.creator_ids;
end;
$$;

revoke all on function public.finance_save_member_share(uuid, text, text, text, date, numeric, uuid[]) from public, anon;
grant execute on function public.finance_save_member_share(uuid, text, text, text, date, numeric, uuid[]) to authenticated;
