drop policy if exists "productos servicios administrar" on public.productos_servicios;

create policy "productos servicios crear" on public.productos_servicios
for insert to authenticated
with check (public.tiene_permiso('productos.administrar') or public.tiene_permiso('facturacion.configurar'));

create policy "productos servicios actualizar" on public.productos_servicios
for update to authenticated
using (public.tiene_permiso('productos.administrar') or public.tiene_permiso('facturacion.configurar'))
with check (public.tiene_permiso('productos.administrar') or public.tiene_permiso('facturacion.configurar'));

create policy "productos servicios eliminar" on public.productos_servicios
for delete to authenticated
using (public.tiene_permiso('productos.administrar') or public.tiene_permiso('facturacion.configurar'));

create index if not exists productos_servicios_creado_por_idx on public.productos_servicios(creado_por);
