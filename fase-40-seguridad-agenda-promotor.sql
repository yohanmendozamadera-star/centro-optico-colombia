-- Fase 40: el promotor solo consulta sus citas de jornadas abiertas.
alter policy "agenda lectura"
on public.agendamientos
to authenticated
using (
  public.tiene_permiso('agenda.ver')
  and (
    not exists (
      select 1 from public.perfiles pf
      join public.roles r on r.id = pf.rol_id
      where pf.id = (select auth.uid()) and lower(r.nombre) = 'promotor'
    )
    or (
      creado_por = (select auth.uid())
      and exists (
        select 1 from public.jornadas j
        where j.id = agendamientos.jornada_id
          and j.activo = true and j.eliminado = false and j.estado = 'abierta'
      )
    )
  )
);
