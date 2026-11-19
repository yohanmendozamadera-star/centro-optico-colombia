begin;

-- El celular puede pertenecer a un acudiente y compartirse entre varios pacientes.
-- Se conserva el parámetro p_celular para no romper las versiones anteriores del cliente,
-- pero la detección de duplicados se basa exclusivamente en la identificación.
create or replace function public.buscar_duplicado_paciente(
  p_paciente_id uuid,
  p_identificacion text,
  p_celular text default null
)
returns table(
  id uuid,
  nombre_completo text,
  numero_identificacion text,
  celular_principal text
)
language sql
stable
set search_path = ''
as $$
  select
    p.id,
    p.nombre_completo,
    p.numero_identificacion,
    p.celular_principal
  from public.pacientes p
  where p.activo
    and not p.eliminado
    and (p_paciente_id is null or p.id <> p_paciente_id)
    and regexp_replace(p.numero_identificacion, '[^0-9A-Za-z]', '', 'g') =
        regexp_replace(coalesce(p_identificacion, ''), '[^0-9A-Za-z]', '', 'g')
  limit 1;
$$;

-- Evita que dos pacientes activos tengan la misma identificación aunque se escriba
-- con espacios, puntos o guiones diferentes. Los teléfonos permanecen sin unicidad.
create unique index if not exists pacientes_identificacion_normalizada_activa_uidx
  on public.pacientes (
    regexp_replace(numero_identificacion, '[^0-9A-Za-z]', '', 'g')
  )
  where activo = true and eliminado = false;

commit;
