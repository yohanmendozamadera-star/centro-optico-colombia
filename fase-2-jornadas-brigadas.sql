-- Fase 2: Jornadas visuales y brigadas
-- Ejecutar una sola vez después de schema.sql.

insert into public.permisos(codigo,modulo,accion,descripcion) values
('jornadas.ver','jornadas','ver','Consultar jornadas'),
('jornadas.crear','jornadas','crear','Crear jornadas'),
('jornadas.editar','jornadas','editar','Editar jornadas'),
('jornadas.cerrar','jornadas','cerrar','Cerrar o reabrir jornadas'),
('brigadas.ver','brigadas','ver','Consultar brigadas'),
('brigadas.crear','brigadas','crear','Crear brigadas'),
('brigadas.editar','brigadas','editar','Editar brigadas'),
('brigadas.cerrar','brigadas','cerrar','Finalizar brigadas')
on conflict (codigo) do nothing;

insert into public.roles_permisos(rol_id,permiso_id)
select r.id,p.id from public.roles r cross join public.permisos p
where r.nombre in ('Superadministrador','Propietario')
and p.modulo in ('jornadas','brigadas')
on conflict do nothing;

create table if not exists public.jornadas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  departamento text not null,
  municipio text not null,
  valor_consulta numeric(12,2) not null check (valor_consulta >= 0),
  estado text not null default 'abierta' check (estado in ('abierta','cerrada')),
  fecha_brigada date not null,
  hora_inicial time,
  hora_final time,
  lugar text not null,
  direccion text,
  observaciones text,
  coordinador_id uuid references public.perfiles(id),
  activo boolean not null default true,
  eliminado boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid references public.perfiles(id),
  creado_por uuid not null default auth.uid() references public.perfiles(id),
  modificado_por uuid references public.perfiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jornadas_fecha_idx on public.jornadas(fecha_brigada);
create index if not exists jornadas_estado_idx on public.jornadas(estado);
create index if not exists jornadas_municipio_idx on public.jornadas(municipio);

create table if not exists public.brigadas (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references public.jornadas(id),
  nombre text not null,
  fecha date not null,
  hora_inicial time,
  hora_final time,
  lugar text not null,
  direccion text,
  coordinador_id uuid references public.perfiles(id),
  estado text not null default 'programada' check (estado in ('programada','en_ejecucion','finalizada','cancelada')),
  capacidad_maxima integer check (capacidad_maxima is null or capacidad_maxima > 0),
  observaciones text,
  activo boolean not null default true,
  eliminado boolean not null default false,
  creado_por uuid not null default auth.uid() references public.perfiles(id),
  modificado_por uuid references public.perfiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists brigadas_jornada_idx on public.brigadas(jornada_id);
create index if not exists brigadas_fecha_idx on public.brigadas(fecha);
create index if not exists brigadas_estado_idx on public.brigadas(estado);

drop trigger if exists jornadas_actualizar_fecha on public.jornadas;
create trigger jornadas_actualizar_fecha before update on public.jornadas for each row execute procedure public.actualizar_fecha();
drop trigger if exists brigadas_actualizar_fecha on public.brigadas;
create trigger brigadas_actualizar_fecha before update on public.brigadas for each row execute procedure public.actualizar_fecha();

create or replace function public.auditar_cambio()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.bitacora(usuario_id,accion,modulo,tabla,registro_id,informacion_anterior,informacion_nueva)
  values(auth.uid(),lower(tg_op),tg_table_name,tg_table_name,
    coalesce(new.id,old.id)::text,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end);
  return coalesce(new,old);
end;
$$;
drop trigger if exists jornadas_auditoria on public.jornadas;
create trigger jornadas_auditoria after insert or update or delete on public.jornadas for each row execute procedure public.auditar_cambio();
drop trigger if exists brigadas_auditoria on public.brigadas;
create trigger brigadas_auditoria after insert or update or delete on public.brigadas for each row execute procedure public.auditar_cambio();

alter table public.jornadas enable row level security;
alter table public.brigadas enable row level security;
create policy "jornadas lectura" on public.jornadas for select to authenticated using (public.tiene_permiso('jornadas.ver'));
create policy "jornadas creacion" on public.jornadas for insert to authenticated with check (public.tiene_permiso('jornadas.crear') and creado_por=auth.uid());
create policy "jornadas edicion" on public.jornadas for update to authenticated using (public.tiene_permiso('jornadas.editar')) with check (public.tiene_permiso('jornadas.editar'));
create policy "brigadas lectura" on public.brigadas for select to authenticated using (public.tiene_permiso('brigadas.ver'));
create policy "brigadas creacion" on public.brigadas for insert to authenticated with check (public.tiene_permiso('brigadas.crear') and creado_por=auth.uid());
create policy "brigadas edicion" on public.brigadas for update to authenticated using (public.tiene_permiso('brigadas.editar')) with check (public.tiene_permiso('brigadas.editar'));
grant select,insert,update on public.jornadas,public.brigadas to authenticated;
grant usage,select on sequence public.bitacora_id_seq to authenticated;
notify pgrst,'reload schema';
