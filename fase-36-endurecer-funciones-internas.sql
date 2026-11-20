alter function public.actualizar_fecha() set search_path=pg_catalog,public;

revoke all on function public.auditar_cambio() from public,anon,authenticated;
revoke all on function public.crear_perfil_nuevo() from public,anon,authenticated;

revoke all on function public.tiene_permiso(text) from public,anon;
grant execute on function public.tiene_permiso(text) to authenticated;
