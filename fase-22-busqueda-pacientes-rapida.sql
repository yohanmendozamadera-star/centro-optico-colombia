-- Evita recorridos completos al buscar pacientes desde Agenda.
-- Identificación y celular son coincidencias exactas; el nombre admite parciales.

create extension if not exists pg_trgm with schema extensions;

create index if not exists pacientes_identificacion_busqueda_idx
on public.pacientes ((regexp_replace(numero_identificacion,'[^0-9A-Za-z]','','g')))
where activo = true and eliminado = false;

create index if not exists pacientes_celular_principal_busqueda_idx
on public.pacientes ((regexp_replace(coalesce(celular_principal,''),'[^0-9]','','g')))
where activo = true and eliminado = false;

create index if not exists pacientes_celular_alternativo_busqueda_idx
on public.pacientes ((regexp_replace(coalesce(celular_alternativo,''),'[^0-9]','','g')))
where activo = true and eliminado = false;

create index if not exists pacientes_nombre_busqueda_trgm_idx
on public.pacientes using gin (nombre_completo extensions.gin_trgm_ops)
where activo = true and eliminado = false;

create or replace function public.buscar_pacientes(p_tipo text,p_valor text)
returns table(
  id uuid, tipo_identificacion text, numero_identificacion text,
  nombre_completo text, celular_principal text, celular_alternativo text,
  genero text, fecha_nacimiento date, correo text, observaciones text,
  ubicacion_registro text, latitud_registro numeric, longitud_registro numeric,
  precision_ubicacion_metros numeric, identificacion_provisional boolean,
  created_at timestamptz
)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_valor text := btrim(coalesce(p_valor,''));
  v_identificacion text := regexp_replace(btrim(coalesce(p_valor,'')),'[^0-9A-Za-z]','','g');
  v_digitos text := regexp_replace(btrim(coalesce(p_valor,'')),'[^0-9]','','g');
begin
  if not public.tiene_permiso('pacientes.ver')
     and not public.tiene_permiso('agenda.crear') then
    raise exception 'No tiene permiso para consultar pacientes';
  end if;
  if p_tipo not in ('identificacion','celular','nombre') then
    raise exception 'Criterio de consulta inválido';
  end if;
  if char_length(v_valor) < (case when p_tipo='nombre' then 3 else 4 end) then
    raise exception 'Escriba un dato más completo para consultar';
  end if;
  return query
  select p.id,p.tipo_identificacion,p.numero_identificacion,p.nombre_completo,
         p.celular_principal,p.celular_alternativo,p.genero,p.fecha_nacimiento,
         p.correo,p.observaciones,p.ubicacion_registro,p.latitud_registro,
         p.longitud_registro,p.precision_ubicacion_metros,
         p.identificacion_provisional,p.created_at
  from public.pacientes p
  where p.activo and not p.eliminado and (
    (p_tipo='identificacion' and regexp_replace(p.numero_identificacion,'[^0-9A-Za-z]','','g') = v_identificacion)
    or (p_tipo='celular' and (
      regexp_replace(coalesce(p.celular_principal,''),'[^0-9]','','g') = v_digitos
      or regexp_replace(coalesce(p.celular_alternativo,''),'[^0-9]','','g') = v_digitos
    ))
    or (p_tipo='nombre' and p.nombre_completo ilike '%' || v_valor || '%')
  )
  order by p.nombre_completo
  limit 25;
end;
$$;

revoke all on function public.buscar_pacientes(text,text) from public,anon;
grant execute on function public.buscar_pacientes(text,text) to authenticated;
notify pgrst, 'reload schema';
