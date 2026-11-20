begin;

insert into hers_private.integration_backend(token_hash)
values (sha256(convert_to(repeat('a', 64), 'UTF8')))
on conflict (singleton) do update set token_hash = excluded.token_hash;

set local role anon;
do $$
declare result jsonb;
begin
  if has_schema_privilege(current_user, 'hers_private', 'usage') then
    raise exception 'Una sesión anónima tiene acceso directo a la tabla privada';
  end if;
  begin
    perform public.hers_integration_worker(repeat('b',64), 'status');
    raise exception 'El RPC aceptó una credencial incorrecta';
  exception when insufficient_privilege then null;
  end;
  perform public.hers_integration_worker(repeat('a',64), 'save', jsonb_build_object(
    'service','integration-test-fixture', 'kind','api-key', 'ciphertext',repeat('c',64),
    'updated_by','00000000-0000-4000-8000-000000000001'
  ));
  result := public.hers_integration_worker(repeat('a',64), 'status');
  if result::text like '%ciphertext%' or result::text like '%updated_by%' or
     result::text not like '%integration-test-fixture%' then
    raise exception 'El estado devolvió campos incorrectos';
  end if;
end;
$$;
reset role;
rollback;
select 'Acceso directo bloqueado, token validado y estado sin secretos' as resultado;
