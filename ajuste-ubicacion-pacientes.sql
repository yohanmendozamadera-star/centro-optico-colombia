-- Ajuste: ubicación automática del registro de pacientes.
-- Ejecutar después de fase-3-agendamientos.sql.

alter table public.pacientes
  add column if not exists ubicacion_registro text,
  add column if not exists latitud_registro numeric(10,7),
  add column if not exists longitud_registro numeric(10,7),
  add column if not exists precision_ubicacion_metros numeric(12,2);

comment on column public.pacientes.ubicacion_registro is
'Nombre aproximado del lugar obtenido con autorización del dispositivo.';
comment on column public.pacientes.latitud_registro is
'Latitud capturada con autorización del usuario.';
comment on column public.pacientes.longitud_registro is
'Longitud capturada con autorización del usuario.';
comment on column public.pacientes.precision_ubicacion_metros is
'Precisión aproximada reportada por el dispositivo.';

notify pgrst,'reload schema';
