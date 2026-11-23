-- Fase 41: valida el formato de la identificación al crear paciente desde Agenda.
-- No modifica registros existentes ni otros módulos.

create or replace function private.registrar_paciente_y_agendamiento_impl(
  p_paciente jsonb, p_jornada uuid, p_brigada uuid, p_volante text,
  p_valor numeric, p_saldo_favor numeric, p_abono numeric, p_estado text,
  p_observaciones text, p_responsable uuid default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_paciente_id uuid;
  v_agendamiento_id uuid;
  v_tipo text := upper(coalesce(nullif(btrim(p_paciente->>'tipo_identificacion'), ''), 'CC'));
  v_identificacion text := btrim(p_paciente->>'numero_identificacion');
  v_nombre text := btrim(p_paciente->>'nombre_completo');
  v_celular text := btrim(p_paciente->>'celular_principal');
begin
  if auth.uid() is null or not public.tiene_permiso('pacientes.crear') or not public.tiene_permiso('agenda.crear') then
    raise exception 'No tiene permiso para registrar pacientes y agendamientos';
  end if;
  if nullif(v_identificacion, '') is null then raise exception 'Escribe la identificación del paciente'; end if;
  if v_tipo in ('CC', 'TI') and v_identificacion !~ '^[0-9]+$' then
    raise exception 'Para cédula de ciudadanía y tarjeta de identidad, escribe únicamente números';
  end if;
  if v_tipo = 'OTRO' and v_identificacion !~ '^[0-9A-Za-z-]+$' then
    raise exception 'Para identificación provisional, escribe letras, números o guiones, sin espacios';
  end if;
  if v_tipo not in ('CC', 'TI', 'OTRO') and v_identificacion !~ '^[0-9A-Za-z]+$' then
    raise exception 'Para documentos extranjeros, escribe únicamente letras y números, sin espacios';
  end if;
  if nullif(v_nombre, '') is null then raise exception 'Escribe el nombre completo del paciente'; end if;
  if nullif(v_celular, '') is null then raise exception 'Escribe el celular principal del paciente'; end if;
  if exists (
    select 1 from public.pacientes p where p.activo and not p.eliminado
      and regexp_replace(p.numero_identificacion, '[^0-9A-Za-z]', '', 'g') = regexp_replace(v_identificacion, '[^0-9A-Za-z]', '', 'g')
  ) then raise exception 'La identificación % ya pertenece a otro paciente', v_identificacion; end if;

  insert into public.pacientes(
    tipo_identificacion, numero_identificacion, nombre_completo, celular_principal,
    celular_alternativo, genero, observaciones, creado_por
  ) values (
    v_tipo, v_identificacion, v_nombre, v_celular,
    nullif(btrim(p_paciente->>'celular_alternativo'), ''),
    nullif(btrim(p_paciente->>'genero'), ''),
    nullif(btrim(p_paciente->>'observaciones'), ''), auth.uid()
  ) returning id into v_paciente_id;

  v_agendamiento_id := private.registrar_agendamiento_impl(
    v_paciente_id, p_jornada, p_brigada, p_volante, p_valor,
    p_saldo_favor, p_abono, p_estado, p_observaciones
  );
  if p_responsable is not null and p_responsable <> auth.uid() then
    perform private.asignar_responsable_agendamiento_impl(v_agendamiento_id, p_responsable);
  end if;
  return jsonb_build_object('paciente_id', v_paciente_id, 'agendamiento_id', v_agendamiento_id);
exception when unique_violation then
  raise exception 'La identificación % ya pertenece a otro paciente', v_identificacion;
end;
$function$;

revoke all on function private.registrar_paciente_y_agendamiento_impl(jsonb,uuid,uuid,text,numeric,numeric,numeric,text,text,uuid) from public, anon;
grant execute on function private.registrar_paciente_y_agendamiento_impl(jsonb,uuid,uuid,text,numeric,numeric,numeric,text,text,uuid) to authenticated;
