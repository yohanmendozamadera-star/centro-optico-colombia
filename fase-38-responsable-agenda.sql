-- Fase 38: reasignación controlada del responsable de un agendamiento.

create or replace function private.asignar_responsable_agendamiento_impl(
  p_agendamiento uuid,
  p_responsable uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_rol_actor text;
  v_rol_destino text;
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida';
  end if;

  select r.nombre into v_rol_actor
  from public.perfiles p
  join public.roles r on r.id = p.rol_id
  where p.id = auth.uid() and p.estado = 'activo';

  if coalesce(v_rol_actor, '') not in ('Superadministrador','Propietario','Administrador','Coordinador') then
    raise exception 'No tiene permiso para cambiar quién agendó al paciente';
  end if;

  select r.nombre into v_rol_destino
  from public.perfiles p
  join public.roles r on r.id = p.rol_id
  where p.id = p_responsable and p.estado = 'activo';

  if coalesce(v_rol_destino, '') not in ('Superadministrador','Propietario','Administrador','Coordinador','Promotor') then
    raise exception 'El responsable seleccionado no está disponible para agendar';
  end if;

  update public.agendamientos
  set creado_por = p_responsable,
      modificado_por = auth.uid(),
      updated_at = now()
  where id = p_agendamiento and activo = true;

  if not found then
    raise exception 'El agendamiento no está disponible';
  end if;
end;
$function$;

create or replace function public.asignar_responsable_agendamiento(
  p_agendamiento uuid,
  p_responsable uuid
) returns void
language sql
set search_path = pg_catalog, public, private
as $function$
  select private.asignar_responsable_agendamiento_impl(p_agendamiento, p_responsable);
$function$;

revoke all on function public.asignar_responsable_agendamiento(uuid,uuid) from public, anon;
grant execute on function public.asignar_responsable_agendamiento(uuid,uuid) to authenticated;

revoke all on function private.asignar_responsable_agendamiento_impl(uuid,uuid) from public, anon;
grant execute on function private.asignar_responsable_agendamiento_impl(uuid,uuid) to authenticated;

create or replace function private.registrar_agendamiento_asignado_impl(
  p_paciente uuid,
  p_jornada uuid,
  p_brigada uuid,
  p_volante text,
  p_valor numeric,
  p_saldo_favor numeric,
  p_abono numeric,
  p_estado text,
  p_observaciones text,
  p_responsable uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_id uuid;
begin
  v_id := private.registrar_agendamiento_impl(
    p_paciente, p_jornada, p_brigada, p_volante, p_valor,
    p_saldo_favor, p_abono, p_estado, p_observaciones
  );
  perform private.asignar_responsable_agendamiento_impl(v_id, p_responsable);
  return v_id;
end;
$function$;

create or replace function public.registrar_agendamiento_asignado(
  p_paciente uuid,
  p_jornada uuid,
  p_brigada uuid,
  p_volante text,
  p_valor numeric,
  p_saldo_favor numeric,
  p_abono numeric,
  p_estado text,
  p_observaciones text,
  p_responsable uuid
) returns uuid
language sql
set search_path = pg_catalog, public, private
as $function$
  select private.registrar_agendamiento_asignado_impl(
    p_paciente, p_jornada, p_brigada, p_volante, p_valor,
    p_saldo_favor, p_abono, p_estado, p_observaciones, p_responsable
  );
$function$;

revoke all on function public.registrar_agendamiento_asignado(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text,uuid) from public, anon;
grant execute on function public.registrar_agendamiento_asignado(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text,uuid) to authenticated;

revoke all on function private.registrar_agendamiento_asignado_impl(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text,uuid) from public, anon;
grant execute on function private.registrar_agendamiento_asignado_impl(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text,uuid) to authenticated;

create or replace function private.listar_responsables_agenda_impl()
returns table(id uuid, nombre_completo text, rol text)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_rol_actor text;
begin
  select r.nombre into v_rol_actor
  from public.perfiles p
  join public.roles r on r.id = p.rol_id
  where p.id = auth.uid() and p.estado = 'activo';

  if coalesce(v_rol_actor, '') not in ('Superadministrador','Propietario','Administrador','Coordinador') then
    raise exception 'No tiene permiso para consultar responsables de agenda';
  end if;

  return query
  select p.id, p.nombre_completo, r.nombre
  from public.perfiles p
  join public.roles r on r.id = p.rol_id
  where p.estado = 'activo'
    and r.nombre in ('Superadministrador','Propietario','Administrador','Coordinador','Promotor')
  order by p.nombre_completo;
end;
$function$;

create or replace function public.listar_responsables_agenda()
returns table(id uuid, nombre_completo text, rol text)
language sql
set search_path = pg_catalog, public, private
as $function$
  select * from private.listar_responsables_agenda_impl();
$function$;

revoke all on function public.listar_responsables_agenda() from public, anon;
grant execute on function public.listar_responsables_agenda() to authenticated;

revoke all on function private.listar_responsables_agenda_impl() from public, anon;
grant execute on function private.listar_responsables_agenda_impl() to authenticated;
