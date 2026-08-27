-- Permite al perfil Brigada crear automáticamente su punto operativo
-- cuando una jornada aún no tiene un registro interno de brigada.

insert into public.roles_permisos(rol_id,permiso_id)
select r.id,p.id
from public.roles r
join public.permisos p on p.codigo='brigadas.crear'
where r.nombre='Brigada'
on conflict do nothing;

notify pgrst,'reload schema';
