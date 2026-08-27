-- Fase 9: administración de usuarios, roles y módulos visibles
drop policy if exists "roles administracion fase 9" on public.roles;
create policy "roles administracion fase 9" on public.roles for all to authenticated
using(public.tiene_permiso('permisos.administrar')) with check(public.tiene_permiso('permisos.administrar'));
drop policy if exists "roles permisos administracion fase 9" on public.roles_permisos;
create policy "roles permisos administracion fase 9" on public.roles_permisos for all to authenticated
using(public.tiene_permiso('permisos.administrar')) with check(public.tiene_permiso('permisos.administrar'));
drop policy if exists "perfiles administracion fase 9" on public.perfiles;
drop policy if exists "perfil propio edicion" on public.perfiles;
create policy "perfiles administracion fase 9" on public.perfiles for update to authenticated
using(public.tiene_permiso('usuarios.administrar')) with check(public.tiene_permiso('usuarios.administrar'));
grant insert,update on public.roles to authenticated;
grant insert,delete on public.roles_permisos to authenticated;

create or replace function public.guardar_permisos_rol(p_rol uuid,p_permisos uuid[])
returns void language plpgsql security invoker set search_path=public as $$
declare nombre_rol text;
begin
  if not public.tiene_permiso('permisos.administrar') then raise exception 'No tiene permiso para administrar roles'; end if;
  select nombre into nombre_rol from public.roles where id=p_rol for update;
  if nombre_rol='Superadministrador' then raise exception 'El rol Superadministrador conserva acceso completo'; end if;
  delete from public.roles_permisos where rol_id=p_rol;
  insert into public.roles_permisos(rol_id,permiso_id)
  select p_rol,id from public.permisos where id=any(coalesce(p_permisos,array[]::uuid[]));
end;$$;

create or replace function public.actualizar_usuario_administracion(p_usuario uuid,p_rol uuid,p_estado text)
returns void language plpgsql security invoker set search_path=public as $$
declare correo_usuario text; rol_destino text;
begin
  if not public.tiene_permiso('usuarios.administrar') then raise exception 'No tiene permiso para administrar usuarios'; end if;
  if p_estado not in('activo','inactivo','suspendido') then raise exception 'Estado no válido'; end if;
  select correo into correo_usuario from public.perfiles where id=p_usuario;
  select nombre into rol_destino from public.roles where id=p_rol and activo;
  if rol_destino is null then raise exception 'Rol no disponible'; end if;
  if lower(correo_usuario)='yohan_mendoza@outlook.com' and (rol_destino<>'Superadministrador' or p_estado<>'activo') then
    raise exception 'La cuenta principal debe conservar el rol Superadministrador y permanecer activa';
  end if;
  update public.perfiles set rol_id=p_rol,estado=p_estado,updated_at=now() where id=p_usuario;
end;$$;
grant execute on function public.guardar_permisos_rol(uuid,uuid[]) to authenticated;
grant execute on function public.actualizar_usuario_administracion(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
