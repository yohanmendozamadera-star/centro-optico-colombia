-- Edición administrativa real de usuarios desde una Edge Function.
-- Solo service_role puede ejecutar esta operación; el navegador nunca recibe esa clave.
create or replace function public.admin_actualizar_perfil_usuario(
  p_actor uuid,
  p_usuario uuid,
  p_nombre text,
  p_correo text,
  p_celular text,
  p_rol uuid,
  p_estado text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anterior public.perfiles%rowtype;
  v_nuevo public.perfiles%rowtype;
  v_rol_destino text;
  v_rol_actor text;
begin
  if p_estado not in ('activo','inactivo','suspendido') then
    raise exception 'Estado no válido';
  end if;

  select * into strict v_anterior from public.perfiles where id=p_usuario for update;
  select nombre into v_rol_destino from public.roles where id=p_rol and activo;
  select r.nombre into v_rol_actor from public.perfiles pf join public.roles r on r.id=pf.rol_id where pf.id=p_actor and pf.estado='activo';

  if v_rol_destino is null then raise exception 'Rol no disponible'; end if;
  if v_rol_destino='Superadministrador' and v_rol_actor<>'Superadministrador' then
    raise exception 'Solo un Superadministrador puede asignar ese rol';
  end if;
  if lower(v_anterior.correo)='yohan_mendoza@outlook.com' and
     (lower(trim(p_correo))<>lower(v_anterior.correo) or v_rol_destino<>'Superadministrador' or p_estado<>'activo') then
    raise exception 'La cuenta principal debe conservar su correo, rol y estado activo';
  end if;

  update public.perfiles
     set nombre_completo=trim(p_nombre), correo=lower(trim(p_correo)), celular=nullif(trim(coalesce(p_celular,'')),''),
         rol_id=p_rol, estado=p_estado, updated_at=now()
   where id=p_usuario
   returning * into v_nuevo;

  insert into public.bitacora(usuario_id,accion,modulo,tabla,registro_id,informacion_anterior,informacion_nueva)
  values(p_actor,'actualizar','usuarios','perfiles',p_usuario::text,
    jsonb_build_object('nombre_completo',v_anterior.nombre_completo,'correo',v_anterior.correo,'celular',v_anterior.celular,'rol_id',v_anterior.rol_id,'estado',v_anterior.estado),
    jsonb_build_object('nombre_completo',v_nuevo.nombre_completo,'correo',v_nuevo.correo,'celular',v_nuevo.celular,'rol_id',v_nuevo.rol_id,'estado',v_nuevo.estado));
end;
$$;

revoke all on function public.admin_actualizar_perfil_usuario(uuid,uuid,text,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_actualizar_perfil_usuario(uuid,uuid,text,text,text,uuid,text) to service_role;
notify pgrst, 'reload schema';
