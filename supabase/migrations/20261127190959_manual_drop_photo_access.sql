create table hers_private.manual_drop_photo_access (
  singleton boolean primary key default true check (singleton),
  token_hash bytea not null check (octet_length(token_hash) = 32)
);

alter table hers_private.manual_drop_photo_access enable row level security;
revoke all on hers_private.manual_drop_photo_access from public, anon, authenticated, service_role;

create function public.manual_drop_photo_authorized(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_token ~ '^[0-9a-f]{64}$' and exists (
    select from hers_private.manual_drop_photo_access
    where token_hash = sha256(convert_to(p_token, 'UTF8'))
  );
$$;

revoke all on function public.manual_drop_photo_authorized(text) from public, anon, authenticated;
grant execute on function public.manual_drop_photo_authorized(text) to service_role;
