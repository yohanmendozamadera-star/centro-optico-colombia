create or replace function public.registrar_pago_venta_completo(
  p_venta uuid,
  p_valor numeric,
  p_metodo text,
  p_observaciones text default null,
  p_emitir_factura boolean default false,
  p_cliente jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v public.ventas%rowtype;
  v_movimiento uuid;
  v_saldo numeric;
  v_facturar boolean;
begin
  if not public.tiene_permiso('recaudos.registrar') then
    raise exception 'No tiene permiso para registrar recaudos';
  end if;

  select * into v
  from public.ventas
  where id = p_venta
  for update;

  if not found or v.estado = 'anulada' then
    raise exception 'Venta no disponible';
  end if;
  if coalesce(p_valor, 0) <= 0 or p_valor > v.saldo then
    raise exception 'El pago debe ser mayor a cero y no superar el saldo';
  end if;
  if coalesce(p_emitir_factura, false) and p_valor <> v.saldo then
    raise exception 'La factura electrónica solo puede activarse al completar todo el saldo';
  end if;

  if coalesce(p_emitir_factura, false) and not v.requiere_factura_electronica then
    if not public.tiene_permiso('facturacion.emitir') then
      raise exception 'No tiene permiso para solicitar facturación electrónica';
    end if;
    if p_cliente is null
       or nullif(btrim(p_cliente->>'tipo_documento'), '') is null
       or nullif(btrim(p_cliente->>'identificacion'), '') is null
       or nullif(btrim(p_cliente->>'nombre'), '') is null
       or nullif(btrim(p_cliente->>'correo'), '') is null
       or nullif(btrim(p_cliente->>'municipio_codigo'), '') is null then
      raise exception 'Completa los datos fiscales obligatorios del cliente';
    end if;

    insert into public.facturas_electronicas(
      venta_id, concepto_facturacion_id, referencia,
      cliente_tipo_documento, cliente_identificacion, cliente_dv,
      cliente_tipo_organizacion, cliente_nombre, cliente_correo,
      cliente_telefono, cliente_direccion, cliente_municipio_codigo,
      fecha_vencimiento_credito
    ) values (
      v.id, v.concepto_facturacion_id, 'VENTA-' || v.id::text,
      p_cliente->>'tipo_documento', p_cliente->>'identificacion', nullif(p_cliente->>'dv', ''),
      coalesce(nullif(p_cliente->>'tipo_organizacion', ''), '2'), p_cliente->>'nombre', lower(p_cliente->>'correo'),
      nullif(p_cliente->>'telefono', ''), nullif(p_cliente->>'direccion', ''), p_cliente->>'municipio_codigo',
      null
    );

    update public.ventas
    set requiere_factura_electronica = true,
        updated_at = now()
    where id = v.id;
    v.requiere_factura_electronica := true;
  end if;

  if v.requiere_factura_electronica
     and not exists (select 1 from public.facturas_electronicas f where f.venta_id = v.id) then
    raise exception 'La venta está marcada para factura electrónica, pero le faltan los datos fiscales';
  end if;

  insert into public.movimientos_financieros(
    paciente_id, jornada_id, brigada_id, venta_id,
    tipo, valor, metodo_pago, canal, observaciones
  ) values (
    v.paciente_id, v.jornada_id, v.brigada_id, v.id,
    'pago_venta', p_valor, coalesce(nullif(p_metodo, ''), 'efectivo'), 'administracion', p_observaciones
  ) returning id into v_movimiento;

  v_saldo := v.saldo - p_valor;
  update public.ventas
  set abono = abono + p_valor,
      saldo = v_saldo,
      estado = case when v_saldo = 0 then 'pagada' else 'pendiente' end,
      updated_at = now()
  where id = v.id;

  v_facturar := v_saldo = 0 and v.requiere_factura_electronica;
  return jsonb_build_object(
    'movimiento_id', v_movimiento,
    'saldo_restante', v_saldo,
    'emitir_factura', v_facturar
  );
end;
$$;

revoke all on function public.registrar_pago_venta_completo(uuid,numeric,text,text,boolean,jsonb) from public, anon;
grant execute on function public.registrar_pago_venta_completo(uuid,numeric,text,text,boolean,jsonb) to authenticated;
