-- Evita que el bloqueo interno de la venta sea ocultado por RLS.
-- La funcion conserva la validacion explicita del permiso de facturacion.
create or replace function public.preparar_emision_factura(p_venta uuid)
returns public.facturas_electronicas
language plpgsql
security definer
set search_path=public
as $$
declare
  v_factura public.facturas_electronicas%rowtype;
  v_venta public.ventas%rowtype;
  v_limite integer;
  v_usadas integer;
begin
  if auth.uid() is null or not public.tiene_permiso('facturacion.emitir') then
    raise exception 'No tiene permiso para emitir facturacion electronica';
  end if;

  select * into v_venta from public.ventas where id=p_venta for update;
  if not found or v_venta.estado='anulada' then raise exception 'Venta no disponible'; end if;
  if coalesce(v_venta.saldo,0)>0 then
    raise exception 'La factura se emitira cuando la venta quede completamente pagada';
  end if;

  perform pg_advisory_xact_lock(hashtext('centro-optico-cupo-factus'));
  select * into v_factura from public.facturas_electronicas where venta_id=p_venta for update;
  if not found then raise exception 'La venta no tiene una solicitud de factura electronica'; end if;
  if v_factura.estado='validada' then return v_factura; end if;

  select limite_documentos into v_limite from public.configuracion_facturacion where id=true;
  select count(*) into v_usadas from public.facturas_electronicas
  where estado in ('validada','procesando') and venta_id<>p_venta;
  if v_usadas >= coalesce(v_limite,60) then
    raise exception 'Se alcanzo el limite contratado de % facturas electronicas',coalesce(v_limite,60);
  end if;

  update public.facturas_electronicas
  set estado='procesando',intentos=intentos+1,ultimo_error=null,updated_at=now()
  where venta_id=p_venta returning * into v_factura;
  return v_factura;
end;
$$;

revoke all on function public.preparar_emision_factura(uuid) from public;
grant execute on function public.preparar_emision_factura(uuid) to authenticated;
