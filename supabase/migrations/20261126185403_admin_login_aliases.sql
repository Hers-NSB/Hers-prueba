create table public.admin_login_aliases (username text primary key check (username ~ '^[A-Za-z0-9_]{1,64}$'), user_id uuid not null unique references auth.users(id) on delete cascade, email text not null);
alter table public.admin_login_aliases enable row level security;
revoke all on public.admin_login_aliases from public, anon, authenticated;
grant select on public.admin_login_aliases to service_role;
