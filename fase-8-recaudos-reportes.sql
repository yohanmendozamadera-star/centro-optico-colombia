-- Fase 8: recaudos, anulaciones auditables y reportes
insert into public.permisos(codigo,modulo,accion,descripcion) values
('recaudos.ver','recaudos','ver','Consultar recaudos y cartera'),
('recaudos.registrar','recaudos','registrar','Registrar pagos pendientes'),
('recaudos.anular','recaudos','anular','Anular movimientos financieros'),
('reportes.ver','reportes','ver','Consultar y exportar reportes') on conflict(codigo) do nothing;
insert into public.roles_permisos(rol_id,permiso_id)
select r.id,p.id from public.roles r cross join public.permisos p
where r.nombre in('Superadministrador','Propietario') and p.modulo in('recaudos','reportes') on conflict do nothing;

create index if not exists movimientos_fecha_idx on public.movimientos_financieros(created_at);
create index if not exists movimientos_jornada_idx on public.movimientos_financieros(jornada_id);
create index if not exists movimientos_usuario_idx on public.movimientos_financieros(recibido_por);
drop policy if exists "movimientos edicion fase 8" on public.movimientos_financieros;
create policy "movimientos edicion fase 8" on public.movimientos_financieros for update to authenticated
using(public.tiene_permiso('recaudos.anular')) with check(public.tiene_permiso('recaudos.anular'));
grant update on public.movimientos_financieros to authenticated;

create or replace function public.registrar_pago_venta(p_venta uuid,p_valor numeric,p_metodo text,p_observaciones text default null)
returns uuid language plpgsql security invoker set search_path=public as $$
declare v public.ventas%rowtype; mid uuid;
begin
  if not public.tiene_permiso('recaudos.registrar') then raise exception 'No tiene permiso para registrar recaudos'; end if;
  select * into v from public.ventas where id=p_venta for update;
  if not found or v.estado='anulada' then raise exception 'Venta no disponible'; end if;
  if p_valor<=0 or p_valor>v.saldo then raise exception 'El pago debe ser mayor a cero y no superar el saldo'; end if;
  insert into public.movimientos_financieros(paciente_id,jornada_id,brigada_id,venta_id,tipo,valor,metodo_pago,canal,observaciones)
  values(v.paciente_id,v.jornada_id,v.brigada_id,v.id,'pago_venta',p_valor,coalesce(nullif(p_metodo,''),'efectivo'),'administracion',p_observaciones) returning id into mid;
  update public.ventas set abono=abono+p_valor,saldo=saldo-p_valor,estado=case when saldo-p_valor=0 then 'pagada' else 'pendiente' end,updated_at=now() where id=v.id;
  return mid;
end;$$;

create or replace function public.anular_movimiento(p_movimiento uuid,p_motivo text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare m public.movimientos_financieros%rowtype; aid uuid;
begin
  if not public.tiene_permiso('recaudos.anular') then raise exception 'No tiene permiso para anular recaudos'; end if;
  if length(trim(coalesce(p_motivo,'')))<5 then raise exception 'Debes indicar el motivo de la anulacion'; end if;
  select * into m from public.movimientos_financieros where id=p_movimiento for update;
  if not found or m.estado<>'activo' or m.tipo in('anulacion','devolucion') then raise exception 'Movimiento no disponible para anulacion'; end if;
  update public.movimientos_financieros set estado='anulado',observaciones=concat_ws(' | ',observaciones,'ANULADO: '||trim(p_motivo)) where id=m.id;
  insert into public.movimientos_financieros(paciente_id,jornada_id,brigada_id,agendamiento_id,venta_id,tipo,valor,metodo_pago,canal,observaciones)
  values(m.paciente_id,m.jornada_id,m.brigada_id,m.agendamiento_id,m.venta_id,'anulacion',m.valor,m.metodo_pago,m.canal,'Revierte '||m.id||': '||trim(p_motivo)) returning id into aid;
  if m.venta_id is not null and m.tipo='pago_venta' then update public.ventas set abono=greatest(abono-m.valor,0),saldo=least(saldo+m.valor,total),estado='pendiente',updated_at=now() where id=m.venta_id; end if;
  return aid;
end;$$;
grant execute on function public.registrar_pago_venta(uuid,numeric,text,text) to authenticated;
grant execute on function public.anular_movimiento(uuid,text) to authenticated;
notify pgrst,'reload schema';
