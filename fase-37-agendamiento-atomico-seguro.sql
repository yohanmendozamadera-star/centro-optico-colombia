create or replace function private.registrar_agendamiento_impl(
  p_paciente uuid,p_jornada uuid,p_brigada uuid,p_volante text,p_valor numeric,
  p_saldo_favor numeric,p_abono numeric,p_estado text,p_observaciones text
)
returns uuid language plpgsql security definer
set search_path=pg_catalog,public,private
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not public.tiene_permiso('agenda.crear') then
    raise exception 'No tiene permiso para registrar agendamientos';
  end if;
  if nullif(btrim(p_volante),'') is null then raise exception 'Escribe el número de volante'; end if;
  if coalesce(p_valor,0)<0 or coalesce(p_abono,0)<0 or coalesce(p_saldo_favor,0)<0 then
    raise exception 'Los valores del agendamiento no pueden ser negativos';
  end if;
  if coalesce(p_abono,0)+coalesce(p_saldo_favor,0)>coalesce(p_valor,0) then
    raise exception 'El abono y el saldo a favor no pueden superar el valor de la consulta';
  end if;
  if not exists(select 1 from public.pacientes where id=p_paciente and activo and not eliminado) then
    raise exception 'El paciente no está disponible';
  end if;
  if not exists(select 1 from public.jornadas where id=p_jornada and activo and not eliminado and estado='abierta') then
    raise exception 'La jornada seleccionada ya no está abierta';
  end if;

  insert into public.agendamientos(
    paciente_id,jornada_id,brigada_id,numero_volante,valor_consulta,
    saldo_favor_aplicado,abono,estado,observaciones
  ) values (
    p_paciente,p_jornada,p_brigada,btrim(p_volante),coalesce(p_valor,0),
    coalesce(p_saldo_favor,0),coalesce(p_abono,0),p_estado,p_observaciones
  ) returning id into v_id;

  if coalesce(p_abono,0)>0 then
    insert into public.movimientos_financieros(
      paciente_id,jornada_id,brigada_id,agendamiento_id,tipo,valor
    ) values (p_paciente,p_jornada,p_brigada,v_id,'abono_agendamiento',p_abono);
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception 'El número de volante % ya está registrado en esta jornada',btrim(p_volante);
end;
$$;

revoke all on function private.registrar_agendamiento_impl(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text) from public,anon;
grant execute on function private.registrar_agendamiento_impl(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text) to authenticated;

create or replace function public.registrar_agendamiento(
  p_paciente uuid,p_jornada uuid,p_brigada uuid,p_volante text,p_valor numeric,
  p_saldo_favor numeric,p_abono numeric,p_estado text,p_observaciones text
)
returns uuid language sql security invoker set search_path=pg_catalog,public,private
as $$
  select private.registrar_agendamiento_impl(
    p_paciente,p_jornada,p_brigada,p_volante,p_valor,p_saldo_favor,p_abono,p_estado,p_observaciones
  );
$$;
revoke all on function public.registrar_agendamiento(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text) from public,anon;
grant execute on function public.registrar_agendamiento(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text) to authenticated;
