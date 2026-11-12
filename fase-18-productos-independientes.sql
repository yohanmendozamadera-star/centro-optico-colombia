create table if not exists public.productos_servicios (
  id uuid primary key default gen_random_uuid(),
  categoria text not null check (categoria in ('montura','lente','servicio','accesorio')),
  codigo text not null unique,
  nombre text not null,
  descripcion text,
  precio numeric not null check (precio >= 0),
  unidad_medida_codigo text not null default '94',
  codigo_estandar text not null default '999',
  excluido_iva boolean not null default true,
  activo boolean not null default true,
  creado_por uuid not null default auth.uid() references public.perfiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.productos_servicios enable row level security;
grant select, insert, update, delete on public.productos_servicios to authenticated;

drop policy if exists "productos servicios lectura" on public.productos_servicios;
create policy "productos servicios lectura" on public.productos_servicios
for select to authenticated
using (
  public.tiene_permiso('productos.ver') or
  public.tiene_permiso('ventas.crear') or
  public.tiene_permiso('facturacion.ver') or
  public.tiene_permiso('facturacion.configurar')
);

drop policy if exists "productos servicios administrar" on public.productos_servicios;
create policy "productos servicios administrar" on public.productos_servicios
for all to authenticated
using (public.tiene_permiso('productos.administrar') or public.tiene_permiso('facturacion.configurar'))
with check (public.tiene_permiso('productos.administrar') or public.tiene_permiso('facturacion.configurar'));

alter table public.ventas_detalle
  add column if not exists producto_id uuid references public.productos_servicios(id),
  add column if not exists categoria text,
  add column if not exists codigo_referencia text,
  add column if not exists descripcion text,
  add column if not exists descuento numeric not null default 0;

alter table public.ventas_detalle alter column montura_id drop not null;
alter table public.ventas_detalle alter column tipo_lente_id drop not null;
alter table public.ventas_detalle alter column material_id drop not null;
alter table public.ventas_detalle alter column filtro_id drop not null;
alter table public.ventas_detalle alter column tratamiento_id drop not null;
alter table public.ventas_detalle alter column fabricacion_id drop not null;
alter table public.facturas_electronicas alter column concepto_facturacion_id drop not null;

create index if not exists ventas_detalle_producto_idx on public.ventas_detalle(producto_id);
create index if not exists productos_servicios_categoria_idx on public.productos_servicios(categoria) where activo;

create or replace function public.registrar_venta_carrito(
  p_consulta uuid,
  p_paciente uuid,
  p_items jsonb,
  p_abono numeric,
  p_metodo text,
  p_entrega date,
  p_observaciones text,
  p_requiere_factura boolean,
  p_concepto_facturacion uuid,
  p_cliente jsonb,
  p_vencimiento date
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_consulta public.consultas_optometricas%rowtype;
  v_producto public.productos_servicios%rowtype;
  v_item jsonb;
  v_venta uuid;
  v_jornada uuid;
  v_brigada uuid;
  v_subtotal numeric := 0;
  v_descuento numeric := 0;
  v_total numeric := 0;
  v_cantidad integer;
  v_descuento_item numeric;
begin
  if not public.tiene_permiso('ventas.crear') then raise exception 'No tiene permiso para registrar ventas'; end if;
  if p_paciente is null then raise exception 'Selecciona un paciente'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agrega al menos un producto al carrito'; end if;
  if coalesce(p_abono, 0) < 0 then raise exception 'El abono no puede ser negativo'; end if;

  if p_consulta is not null then
    select * into v_consulta from public.consultas_optometricas where id = p_consulta and paciente_id = p_paciente;
    if not found then raise exception 'La consulta seleccionada no corresponde al paciente'; end if;
    v_jornada := v_consulta.jornada_id;
    v_brigada := v_consulta.brigada_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_cantidad := greatest(coalesce((v_item->>'cantidad')::integer, 1), 1);
    v_descuento_item := greatest(coalesce((v_item->>'descuento')::numeric, 0), 0);
    select * into v_producto from public.productos_servicios
      where id = (v_item->>'producto_id')::uuid and activo;
    if not found then raise exception 'Uno de los productos o servicios no está disponible'; end if;
    if v_descuento_item > 0 and not public.tiene_permiso('ventas.descuento') then raise exception 'No tiene permiso para aplicar descuentos'; end if;
    if v_descuento_item > v_producto.precio * v_cantidad then raise exception 'El descuento supera el valor del producto'; end if;
    v_subtotal := v_subtotal + v_producto.precio * v_cantidad;
    v_descuento := v_descuento + v_descuento_item;
  end loop;

  v_total := v_subtotal - v_descuento;
  if coalesce(p_abono, 0) > v_total then raise exception 'El abono no puede superar el total'; end if;
  if coalesce(p_requiere_factura, false) and v_total > coalesce(p_abono, 0) and p_vencimiento is null then raise exception 'Indica la fecha de vencimiento del saldo'; end if;

  insert into public.ventas(consulta_id,paciente_id,jornada_id,brigada_id,subtotal,descuento,total,abono,saldo,metodo_pago,fecha_entrega,estado,observaciones,requiere_factura_electronica,concepto_facturacion_id)
  values(p_consulta,p_paciente,v_jornada,v_brigada,v_subtotal,v_descuento,v_total,coalesce(p_abono,0),v_total-coalesce(p_abono,0),p_metodo,p_entrega,case when coalesce(p_abono,0)=v_total then 'pagada' else 'pendiente' end,p_observaciones,coalesce(p_requiere_factura,false),p_concepto_facturacion)
  returning id into v_venta;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_cantidad := greatest(coalesce((v_item->>'cantidad')::integer, 1), 1);
    v_descuento_item := greatest(coalesce((v_item->>'descuento')::numeric, 0), 0);
    select * into v_producto from public.productos_servicios where id = (v_item->>'producto_id')::uuid;
    insert into public.ventas_detalle(
      venta_id,producto_id,categoria,codigo_referencia,descripcion,
      montura_id,tipo_lente_id,material_id,filtro_id,tratamiento_id,fabricacion_id,
      cantidad,precio_unitario,descuento,subtotal
    ) values (
      v_venta,v_producto.id,v_producto.categoria,v_producto.codigo,
      coalesce(nullif(v_item->>'descripcion',''),v_producto.descripcion,v_producto.nombre),
      nullif(v_item->>'montura_id','')::uuid,nullif(v_item->>'tipo_lente_id','')::uuid,
      nullif(v_item->>'material_id','')::uuid,nullif(v_item->>'filtro_id','')::uuid,
      nullif(v_item->>'tratamiento_id','')::uuid,nullif(v_item->>'fabricacion_id','')::uuid,
      v_cantidad,v_producto.precio,v_descuento_item,(v_producto.precio*v_cantidad)-v_descuento_item
    );
  end loop;

  if coalesce(p_abono,0) > 0 then
    insert into public.movimientos_financieros(paciente_id,jornada_id,brigada_id,venta_id,tipo,valor,metodo_pago,canal)
    values(p_paciente,v_jornada,v_brigada,v_venta,'pago_venta',p_abono,p_metodo,'administracion');
  end if;

  if coalesce(p_requiere_factura,false) then
    insert into public.facturas_electronicas(venta_id,concepto_facturacion_id,referencia,cliente_tipo_documento,cliente_identificacion,cliente_dv,cliente_tipo_organizacion,cliente_nombre,cliente_correo,cliente_telefono,cliente_direccion,cliente_municipio_codigo,fecha_vencimiento_credito)
    values(v_venta,p_concepto_facturacion,'VENTA-'||v_venta::text,p_cliente->>'tipo_documento',p_cliente->>'identificacion',nullif(p_cliente->>'dv',''),coalesce(nullif(p_cliente->>'tipo_organizacion',''),'2'),p_cliente->>'nombre',p_cliente->>'correo',nullif(p_cliente->>'telefono',''),nullif(p_cliente->>'direccion',''),nullif(p_cliente->>'municipio_codigo',''),p_vencimiento);
  end if;
  return v_venta;
end;
$$;

revoke all on function public.registrar_venta_carrito(uuid,uuid,jsonb,numeric,text,date,text,boolean,uuid,jsonb,date) from public;
grant execute on function public.registrar_venta_carrito(uuid,uuid,jsonb,numeric,text,date,text,boolean,uuid,jsonb,date) to authenticated;
