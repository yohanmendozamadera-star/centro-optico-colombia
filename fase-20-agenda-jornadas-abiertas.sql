-- Permite que los usuarios autorizados para Agenda consulten el catálogo
-- mínimo de jornadas disponibles para crear agendamientos.
-- No concede permisos para crear, editar, cerrar ni consultar jornadas
-- inactivas, cerradas, eliminadas o deshabilitadas.

create policy "jornadas catalogo agenda"
on public.jornadas
for select
to authenticated
using (
  public.tiene_permiso('agenda.ver')
  and activo = true
  and eliminado = false
  and estado = 'abierta'
);

notify pgrst, 'reload schema';
