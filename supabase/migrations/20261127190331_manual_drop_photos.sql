insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manual-drop-photos', 'manual-drop-photos', false, 10485760, array['image/jpeg','image/png'])
on conflict (id) do nothing;

create policy manual_drop_photos_admin_upload
  on storage.objects for insert to authenticated
  with check (bucket_id = 'manual-drop-photos' and (select public.finance_is_admin()));

create policy manual_drop_photos_admin_read
  on storage.objects for select to authenticated
  using (bucket_id = 'manual-drop-photos' and (select public.finance_is_admin()));
