-- Fase 5: Jornada inactiva, asistencia y recaudo de brigada

alter table public.jornadas drop constraint if exists jornadas_estado_check;
alter table public.jornadas add constraint jornadas_estado_check
check (estado in ('abierta','inactiva','cerrada'));

insert into public.permisos(codigo,modulo,accion,descripcion) values
('asistencia.ver','asistencia','ver','Consultar pacientes de brigada'),
('asistencia.registrar','asistencia','registrar','Registrar llegada y cumplimiento'),
('asistencia.incumplir','asistencia','incumplir','Marcar cita incumplida'),
('brigada.cobrar','brigada','cobrar','Recibir saldo pendiente en brigada')
on conflict (codigo) do nothing;

insert into public.roles_permisos(rol_id,permiso_id)
select r.id,p.id from public.roles r cross join public.permisos p
where r.nombre in ('Superadministrador','Propietario')
and p.modulo in ('asistencia','brigada')
on conflict do nothing;

insert into public.roles_permisos(rol_id,permiso_id)
select r.id,p.id from public.roles r join public.permisos p on p.codigo in
('pacientes.ver','pacientes.crear','agenda.ver','agenda.crear','agenda.editar',
 'brigadas.ver','asistencia.ver','asistencia.registrar','asistencia.incumplir',
 'pagos.registrar','pagos.ver','brigada.cobrar')
where r.nombre='Brigada'
on conflict do nothing;

insert into public.roles_permisos(rol_id,permiso_id)
select r.id,p.id from public.roles r join public.permisos p on p.codigo in
('agenda.ver','agenda.editar','call_center.ver','call_center.gestionar','call_center.confirmar')
where r.nombre='Call Center'
on conflict do nothing;

create table if not exists public.asistencias (
  id uuid primary key default gen_random_uuid(),
  agendamiento_id uuid not null unique references public.agendamientos(id),
  brigada_id uuid not null references public.brigadas(id),
  hora_llegada timestamptz,
  estado text not null check(estado in ('llego','cumplida','incumplida')),
  registrado_por uuid not null default auth.uid() references public.perfiles(id),
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists asistencias_brigada_idx on public.asistencias(brigada_id,estado);

create or replace function public.completar_cita_brigada(
  p_agendamiento uuid,p_brigada uuid,p_pago numeric,p_metodo text,p_observaciones text
) returns void language plpgsql security invoker set search_path=public as $$
declare v_ag public.agendamientos%rowtype;
begin
  select * into v_ag from public.agendamientos where id=p_agendamiento for update;
  if not found then raise exception 'Agendamiento no encontrado'; end if;
  if v_ag.estado not in ('registrada','confirmada') then raise exception 'La cita no está disponible para cumplimiento'; end if;
  if v_ag.brigada_id is distinct from p_brigada then raise exception 'El paciente no está asignado a esta brigada'; end if;
  if coalesce(p_pago,0) <> v_ag.saldo_pendiente then raise exception 'Debe completar exactamente el saldo pendiente'; end if;
  if coalesce(p_pago,0)>0 then
    insert into public.movimientos_financieros(paciente_id,jornada_id,brigada_id,agendamiento_id,tipo,valor,metodo_pago,canal,observaciones)
    values(v_ag.paciente_id,v_ag.jornada_id,p_brigada,v_ag.id,'pago_brigada',p_pago,p_metodo,'brigada',p_observaciones);
    update public.agendamientos set abono=abono+p_pago where id=v_ag.id;
  end if;
  update public.agendamientos set estado='cumplida' where id=v_ag.id;
  insert into public.asistencias(agendamiento_id,brigada_id,hora_llegada,estado,observaciones)
  values(v_ag.id,p_brigada,now(),'cumplida',p_observaciones)
  on conflict(agendamiento_id) do update set estado='cumplida',hora_llegada=coalesce(public.asistencias.hora_llegada,now()),observaciones=excluded.observaciones,updated_at=now();
end;$$;

create or replace function public.marcar_cita_incumplida(
  p_agendamiento uuid,p_brigada uuid,p_observaciones text
) returns void language plpgsql security invoker set search_path=public as $$
begin
  update public.agendamientos set estado='incumplida'
  where id=p_agendamiento and brigada_id=p_brigada and estado in ('registrada','confirmada');
  if not found then raise exception 'La cita no está disponible'; end if;
  insert into public.asistencias(agendamiento_id,brigada_id,estado,observaciones)
  values(p_agendamiento,p_brigada,'incumplida',p_observaciones)
  on conflict(agendamiento_id) do update set estado='incumplida',observaciones=excluded.observaciones,updated_at=now();
end;$$;

alter table public.asistencias enable row level security;
create policy "asistencias lectura" on public.asistencias for select to authenticated using(public.tiene_permiso('asistencia.ver'));
create policy "asistencias creacion" on public.asistencias for insert to authenticated with check(public.tiene_permiso('asistencia.registrar') and registrado_por=auth.uid());
create policy "asistencias edicion" on public.asistencias for update to authenticated using(public.tiene_permiso('asistencia.registrar'));
grant select,insert,update on public.asistencias to authenticated;
grant execute on function public.completar_cita_brigada(uuid,uuid,numeric,text,text) to authenticated;
grant execute on function public.marcar_cita_incumplida(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
