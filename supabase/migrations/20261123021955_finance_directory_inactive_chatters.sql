create or replace function hers_private.apply_agencykey_directory(p_snapshot jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  perform hers_private.update_existing_agencykey_directory(p_snapshot);

  with added as (
    insert into public.finance_members (agencykey_id, name, role, agencykey_available)
    select id, name, role, coalesce(active, false)
    from jsonb_to_recordset(p_snapshot->'employees') as member(id text, name text, role text, active boolean)
    where role ~* '(^|,) *chatters? *(,|$)'
    on conflict (agencykey_id) do nothing
    returning id, agencykey_available
  )
  insert into public.finance_member_availability (member_id, effective_on, available)
  select id, (statement_timestamp() at time zone 'America/Halifax')::date, false
  from added where not agencykey_available;
end;
$$;
