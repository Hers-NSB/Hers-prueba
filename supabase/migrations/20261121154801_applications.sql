create table public.applications (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  edad integer not null,
  pais text not null,
  email text not null,
  instagram text,
  whatsapp text,
  telegram text,
  limites text not null,
  estilo_contenido text not null,
  convivencia text not null,
  tiene_pareja text not null,
  problema_pareja text not null,
  resultados_limitantes text not null,
  expectativas_aporte text not null,
  preferencias_fetiches text not null,
  foto_natural1_path text,
  foto_natural2_path text,
  foto_natural3_path text,
  foto_lenceria1_path text,
  foto_lenceria2_path text,
  foto_lenceria3_path text,
  created_at timestamptz not null default now()
);

alter table public.applications enable row level security;

revoke all on public.applications from public, anon, authenticated;
grant insert on public.applications to anon, authenticated;
grant select, update, delete on public.applications to authenticated;
grant all on public.applications to service_role;

create policy applications_public_insert
  on public.applications for insert to anon, authenticated
  with check (true);

create policy applications_admin_select
  on public.applications for select to authenticated
  using ((select public.finance_is_admin()));

create policy applications_admin_update
  on public.applications for update to authenticated
  using ((select public.finance_is_admin()))
  with check ((select public.finance_is_admin()));

create policy applications_admin_delete
  on public.applications for delete to authenticated
  using ((select public.finance_is_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'model-photos',
  'model-photos',
  false,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
);

create policy "Public can submit model photos"
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'model-photos'
    and name ~ '^[0-9a-fA-F-]{8,64}/(natural1|natural2|natural3|lenceria1|lenceria2|lenceria3)[.](jpg|jpeg|png|webp|gif)$'
  );

create policy "Team admins can view model photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'model-photos' and (select public.finance_is_admin()));

create policy "Team admins can update model photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'model-photos' and (select public.finance_is_admin()))
  with check (bucket_id = 'model-photos' and (select public.finance_is_admin()));

create policy "Team admins can delete model photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'model-photos' and (select public.finance_is_admin()));
