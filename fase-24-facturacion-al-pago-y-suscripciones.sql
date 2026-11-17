-- Fase 24: factura electronica al completar el pago y base de suscripciones.
-- No contiene credenciales de Bold ni Resend.

create or replace function public.preparar_emision_factura(p_venta uuid)
returns public.facturas_electronicas
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_factura public.facturas_electronicas%rowtype;
  v_venta public.ventas%rowtype;
  v_limite integer;
  v_usadas integer;
begin
  if not public.tiene_permiso('facturacion.emitir') then
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

-- Conserva la solicitud de factura, pero ya no exige vencimiento ni emite mientras exista saldo.
create or replace function public.registrar_venta_carrito(
  p_consulta uuid,p_paciente uuid,p_items jsonb,p_abono numeric,p_metodo text,
  p_entrega date,p_observaciones text,p_requiere_factura boolean,
  p_concepto_facturacion uuid,p_cliente jsonb,p_vencimiento date
) returns uuid
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_consulta public.consultas_optometricas%rowtype;
  v_producto public.productos_servicios%rowtype;
  v_item jsonb;
  v_venta uuid;
  v_jornada uuid;
  v_brigada uuid;
  v_subtotal numeric:=0;
  v_descuento numeric:=0;
  v_total numeric:=0;
  v_cantidad integer;
  v_descuento_item numeric;
begin
  if not public.tiene_permiso('ventas.crear') then raise exception 'No tiene permiso para registrar ventas'; end if;
  if p_paciente is null then raise exception 'Selecciona un paciente'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Agrega al menos un producto al carrito'; end if;
  if coalesce(p_abono,0)<0 then raise exception 'El abono no puede ser negativo'; end if;
  if coalesce(p_requiere_factura,false) and not public.tiene_permiso('facturacion.emitir') then raise exception 'No tiene permiso para solicitar facturacion electronica'; end if;

  if p_consulta is not null then
    select * into v_consulta from public.consultas_optometricas where id=p_consulta and paciente_id=p_paciente;
    if not found then raise exception 'La consulta seleccionada no corresponde al paciente'; end if;
    v_jornada:=v_consulta.jornada_id; v_brigada:=v_consulta.brigada_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_cantidad:=greatest(coalesce((v_item->>'cantidad')::integer,1),1);
    v_descuento_item:=greatest(coalesce((v_item->>'descuento')::numeric,0),0);
    select * into v_producto from public.productos_servicios where id=(v_item->>'producto_id')::uuid and activo;
    if not found then raise exception 'Uno de los productos o servicios no esta disponible'; end if;
    if v_descuento_item>0 and not public.tiene_permiso('ventas.descuento') then raise exception 'No tiene permiso para aplicar descuentos'; end if;
    if v_descuento_item>v_producto.precio*v_cantidad then raise exception 'El descuento supera el valor del producto'; end if;
    v_subtotal:=v_subtotal+v_producto.precio*v_cantidad;
    v_descuento:=v_descuento+v_descuento_item;
  end loop;
  v_total:=v_subtotal-v_descuento;
  if coalesce(p_abono,0)>v_total then raise exception 'El abono no puede superar el total'; end if;

  if coalesce(p_requiere_factura,false) and (
    p_cliente is null or nullif(btrim(p_cliente->>'tipo_documento'),'') is null or
    nullif(btrim(p_cliente->>'identificacion'),'') is null or nullif(btrim(p_cliente->>'nombre'),'') is null or
    nullif(btrim(p_cliente->>'correo'),'') is null or nullif(btrim(p_cliente->>'municipio_codigo'),'') is null
  ) then raise exception 'Completa los datos fiscales obligatorios del cliente'; end if;

  insert into public.ventas(consulta_id,paciente_id,jornada_id,brigada_id,subtotal,descuento,total,abono,saldo,metodo_pago,fecha_entrega,estado,observaciones,requiere_factura_electronica,concepto_facturacion_id)
  values(p_consulta,p_paciente,v_jornada,v_brigada,v_subtotal,v_descuento,v_total,coalesce(p_abono,0),v_total-coalesce(p_abono,0),p_metodo,p_entrega,case when coalesce(p_abono,0)=v_total then 'pagada' else 'pendiente' end,p_observaciones,coalesce(p_requiere_factura,false),p_concepto_facturacion)
  returning id into v_venta;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_cantidad:=greatest(coalesce((v_item->>'cantidad')::integer,1),1);
    v_descuento_item:=greatest(coalesce((v_item->>'descuento')::numeric,0),0);
    select * into v_producto from public.productos_servicios where id=(v_item->>'producto_id')::uuid;
    insert into public.ventas_detalle(venta_id,producto_id,categoria,codigo_referencia,descripcion,montura_id,tipo_lente_id,material_id,filtro_id,tratamiento_id,fabricacion_id,cantidad,precio_unitario,descuento,subtotal,formula_optica)
    values(v_venta,v_producto.id,v_producto.categoria,v_producto.codigo,coalesce(nullif(v_item->>'descripcion',''),v_producto.descripcion,v_producto.nombre),nullif(v_item->>'montura_id','')::uuid,nullif(v_item->>'tipo_lente_id','')::uuid,nullif(v_item->>'material_id','')::uuid,nullif(v_item->>'filtro_id','')::uuid,nullif(v_item->>'tratamiento_id','')::uuid,nullif(v_item->>'fabricacion_id','')::uuid,v_cantidad,v_producto.precio,v_descuento_item,(v_producto.precio*v_cantidad)-v_descuento_item,case when v_producto.categoria='lente' then v_item->'formula_optica' else null end);
  end loop;

  if coalesce(p_abono,0)>0 then
    insert into public.movimientos_financieros(paciente_id,jornada_id,brigada_id,venta_id,tipo,valor,metodo_pago,canal)
    values(p_paciente,v_jornada,v_brigada,v_venta,'pago_venta',p_abono,p_metodo,'administracion');
  end if;
  if coalesce(p_requiere_factura,false) then
    insert into public.facturas_electronicas(venta_id,concepto_facturacion_id,referencia,cliente_tipo_documento,cliente_identificacion,cliente_dv,cliente_tipo_organizacion,cliente_nombre,cliente_correo,cliente_telefono,cliente_direccion,cliente_municipio_codigo,fecha_vencimiento_credito)
    values(v_venta,p_concepto_facturacion,'VENTA-'||v_venta::text,p_cliente->>'tipo_documento',p_cliente->>'identificacion',nullif(p_cliente->>'dv',''),coalesce(nullif(p_cliente->>'tipo_organizacion',''),'2'),p_cliente->>'nombre',lower(p_cliente->>'correo'),nullif(p_cliente->>'telefono',''),nullif(p_cliente->>'direccion',''),p_cliente->>'municipio_codigo',null);
  end if;
  return v_venta;
end;
$$;
revoke all on function public.registrar_venta_carrito(uuid,uuid,jsonb,numeric,text,date,text,boolean,uuid,jsonb,date) from public;
grant execute on function public.registrar_venta_carrito(uuid,uuid,jsonb,numeric,text,date,text,boolean,uuid,jsonb,date) to authenticated;

create table if not exists public.configuracion_suscripcion (
  id boolean primary key default true check (id),
  nombre_plan text not null default 'Plan empresarial',
  concepto text not null default 'Suscripcion mensual al servicio de plataforma web de gestion optica',
  valor_mensual numeric(12,2),
  dia_generacion smallint not null default 17 check (dia_generacion between 1 and 28),
  dia_vencimiento smallint not null default 20 check (dia_vencimiento between 1 and 28),
  dias_gracia smallint not null default 10 check (dias_gracia between 0 and 15),
  fecha_inicio date,
  correo_facturacion text,
  ambiente text not null default 'pruebas' check (ambiente in ('pruebas','produccion')),
  estado text not null default 'configuracion' check (estado in ('configuracion','activa','gracia','restringida','cancelada')),
  updated_at timestamptz not null default now(),
  actualizado_por uuid references public.perfiles(id)
);

insert into public.configuracion_suscripcion(
  id,nombre_plan,concepto,valor_mensual,dia_generacion,dia_vencimiento,dias_gracia,
  fecha_inicio,correo_facturacion,ambiente,estado
) values(
  true,'Plan empresarial','Suscripcion mensual al servicio de plataforma web de gestion optica',
  100000,17,20,10,'2026-11-20','ariza.andres70@gmail.com','produccion','activa'
)
on conflict(id) do update set
  nombre_plan=excluded.nombre_plan,
  concepto=excluded.concepto,
  valor_mensual=excluded.valor_mensual,
  dia_generacion=excluded.dia_generacion,
  dia_vencimiento=excluded.dia_vencimiento,
  dias_gracia=excluded.dias_gracia,
  fecha_inicio=excluded.fecha_inicio,
  correo_facturacion=excluded.correo_facturacion,
  ambiente='produccion',
  estado=case when public.configuracion_suscripcion.estado='restringida' then 'restringida' else 'activa' end,
  updated_at=now();

create table if not exists public.cobros_suscripcion (
  id uuid primary key default gen_random_uuid(),
  referencia text not null unique,
  periodo_desde date not null,
  periodo_hasta date not null,
  fecha_generacion date not null,
  fecha_vencimiento date not null,
  concepto text not null,
  valor numeric(12,2) not null check (valor>=0),
  correo_cliente text not null,
  estado text not null default 'pendiente' check (estado in ('programado','pendiente','pagado','vencido','fallido','anulado')),
  bold_link text,
  bold_referencia text,
  bold_transaccion text,
  bold_entorno text check (bold_entorno in ('pruebas','produccion')),
  metodo_pago text,
  pagado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cobro_periodo_valido check (periodo_hasta>=periodo_desde)
);

create unique index if not exists cobros_suscripcion_periodo_idx on public.cobros_suscripcion(periodo_desde,periodo_hasta);
create index if not exists cobros_suscripcion_estado_idx on public.cobros_suscripcion(estado,fecha_vencimiento);

insert into public.cobros_suscripcion(
  referencia,periodo_desde,periodo_hasta,fecha_generacion,fecha_vencimiento,
  concepto,valor,correo_cliente,estado,bold_entorno
) values(
  'SUB-2026-11','2026-11-20','2026-12-19','2026-11-17','2026-11-20',
  'Suscripcion mensual al servicio de plataforma web de gestion optica',
  100000,'ariza.andres70@gmail.com','pendiente','produccion'
)
on conflict(referencia) do update set
  periodo_desde=excluded.periodo_desde,
  periodo_hasta=excluded.periodo_hasta,
  fecha_generacion=excluded.fecha_generacion,
  fecha_vencimiento=excluded.fecha_vencimiento,
  concepto=excluded.concepto,
  valor=excluded.valor,
  correo_cliente=excluded.correo_cliente,
  updated_at=now();

create table if not exists public.notificaciones_suscripcion (
  id uuid primary key default gen_random_uuid(),
  cobro_id uuid not null references public.cobros_suscripcion(id) on delete cascade,
  tipo text not null check (tipo in ('cobro_generado','recordatorio','restriccion')),
  fecha_programada date not null,
  estado text not null default 'programada' check (estado in ('programada','enviada','omitida','error')),
  intentos smallint not null default 0 check (intentos>=0),
  enviada_at timestamptz,
  ultimo_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(cobro_id,tipo,fecha_programada)
);

insert into public.notificaciones_suscripcion(cobro_id,tipo,fecha_programada)
select c.id,x.tipo,x.fecha
from public.cobros_suscripcion c
cross join (values
  ('cobro_generado'::text,'2026-11-17'::date),
  ('recordatorio','2026-11-19'::date),
  ('recordatorio','2026-11-21'::date),
  ('recordatorio','2026-11-23'::date),
  ('recordatorio','2026-11-25'::date),
  ('recordatorio','2026-11-27'::date),
  ('recordatorio','2026-11-29'::date),
  ('restriccion','2026-12-01'::date)
) as x(tipo,fecha)
where c.referencia='SUB-2026-11'
on conflict(cobro_id,tipo,fecha_programada) do nothing;

alter table public.configuracion_suscripcion enable row level security;
alter table public.cobros_suscripcion enable row level security;
alter table public.notificaciones_suscripcion enable row level security;

drop policy if exists "suscripcion configuracion lectura" on public.configuracion_suscripcion;
create policy "suscripcion configuracion lectura" on public.configuracion_suscripcion
for select to authenticated using (public.tiene_permiso('facturacion.configurar'));
drop policy if exists "suscripcion cobros lectura" on public.cobros_suscripcion;
create policy "suscripcion cobros lectura" on public.cobros_suscripcion
for select to authenticated using (public.tiene_permiso('facturacion.configurar'));
drop policy if exists "suscripcion notificaciones lectura" on public.notificaciones_suscripcion;
create policy "suscripcion notificaciones lectura" on public.notificaciones_suscripcion
for select to authenticated using (public.tiene_permiso('facturacion.configurar'));

grant select on public.configuracion_suscripcion to authenticated;
grant select on public.cobros_suscripcion to authenticated;
grant select on public.notificaciones_suscripcion to authenticated;

-- La restriccion se aplica en base de datos y no depende de ocultar botones.
create or replace function public.bloquear_operacion_por_suscripcion()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if exists(select 1 from public.configuracion_suscripcion where id=true and estado='restringida') then
    raise exception 'Servicio temporalmente restringido por pago pendiente';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists bloquear_agenda_por_suscripcion on public.agendamientos;
create trigger bloquear_agenda_por_suscripcion before insert or update or delete on public.agendamientos
for each row execute function public.bloquear_operacion_por_suscripcion();
drop trigger if exists bloquear_ventas_por_suscripcion on public.ventas;
create trigger bloquear_ventas_por_suscripcion before insert or update or delete on public.ventas
for each row execute function public.bloquear_operacion_por_suscripcion();
drop trigger if exists bloquear_detalle_ventas_por_suscripcion on public.ventas_detalle;
create trigger bloquear_detalle_ventas_por_suscripcion before insert or update or delete on public.ventas_detalle
for each row execute function public.bloquear_operacion_por_suscripcion();
notify pgrst,'reload schema';
