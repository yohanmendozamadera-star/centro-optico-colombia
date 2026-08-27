-- Centro Óptico de Colombia Group
-- Fase inicial: autenticación, roles, permisos, perfiles, pacientes y bitácora.
-- Aplicación para una sola óptica: no contiene empresa_id ni arquitectura multiempresa.

create extension if not exists pgcrypto;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  descripcion text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.permisos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  modulo text not null,
  accion text not null,
  descripcion text,
  created_at timestamptz not null default now()
);

create table if not exists public.roles_permisos (
  rol_id uuid not null references public.roles(id) on delete cascade,
  permiso_id uuid not null references public.permisos(id) on delete cascade,
  primary key (rol_id, permiso_id)
);

create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text not null,
  identificacion text,
  celular text,
  correo text not null,
  rol_id uuid references public.roles(id),
  estado text not null default 'activo' check (estado in ('activo','inactivo','suspendido')),
  ultimo_acceso timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usuarios_permisos (
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  permiso_id uuid not null references public.permisos(id) on delete cascade,
  permitido boolean not null default true,
  primary key (usuario_id, permiso_id)
);

create table if not exists public.pacientes (
  id uuid primary key default gen_random_uuid(),
  tipo_identificacion text not null default 'CC',
  numero_identificacion text not null,
  nombre_completo text not null,
  celular_principal text not null,
  celular_alternativo text,
  genero text,
  fecha_nacimiento date,
  correo text,
  departamento text,
  municipio text,
  direccion text,
  observaciones text,
  activo boolean not null default true,
  eliminado boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid references public.perfiles(id),
  creado_por uuid not null default auth.uid() references public.perfiles(id),
  modificado_por uuid references public.perfiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pacientes_identificacion_unica unique (tipo_identificacion, numero_identificacion)
);
create index if not exists pacientes_nombre_idx on public.pacientes using gin (to_tsvector('spanish', nombre_completo));
create index if not exists pacientes_celular_idx on public.pacientes(celular_principal);
create index if not exists pacientes_municipio_idx on public.pacientes(municipio);

create table if not exists public.bitacora (
  id bigint generated always as identity primary key,
  usuario_id uuid references public.perfiles(id),
  accion text not null,
  modulo text not null,
  tabla text,
  registro_id text,
  informacion_anterior jsonb,
  informacion_nueva jsonb,
  created_at timestamptz not null default now()
);

insert into public.roles(nombre,descripcion) values
('Superadministrador','Acceso completo a toda la aplicación'),
('Propietario','Administración general de la óptica'),
('Coordinador','Coordinación operativa configurable'),
('Promotor','Registro y seguimiento de sus pacientes'),
('Call Center','Confirmación y gestión de llamadas'),
('Brigada','Atención de pacientes durante jornadas')
on conflict (nombre) do nothing;

insert into public.permisos(codigo,modulo,accion,descripcion) values
('pacientes.ver','pacientes','ver','Consultar pacientes'),
('pacientes.crear','pacientes','crear','Registrar pacientes'),
('pacientes.editar','pacientes','editar','Modificar pacientes'),
('pacientes.eliminar','pacientes','eliminar','Inactivar pacientes'),
('usuarios.ver','usuarios','ver','Consultar usuarios'),
('usuarios.administrar','usuarios','administrar','Crear usuarios y asignar roles'),
('permisos.administrar','permisos','administrar','Configurar permisos'),
('bitacora.ver','bitacora','ver','Consultar bitácora')
on conflict (codigo) do nothing;

insert into public.roles_permisos(rol_id,permiso_id)
select r.id,p.id from public.roles r cross join public.permisos p
where r.nombre in ('Superadministrador','Propietario')
on conflict do nothing;

create or replace function public.tiene_permiso(p_codigo text)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists (
    select 1 from public.perfiles pf
    join public.roles r on r.id=pf.rol_id and r.activo
    left join public.roles_permisos rp on rp.rol_id=r.id
    left join public.permisos p on p.id=rp.permiso_id
    left join public.usuarios_permisos up on up.usuario_id=pf.id
    left join public.permisos pu on pu.id=up.permiso_id
    where pf.id=auth.uid() and pf.estado='activo'
      and ((p.codigo=p_codigo) or (pu.codigo=p_codigo and up.permitido))
  );
$$;

create or replace function public.crear_perfil_nuevo()
returns trigger language plpgsql security definer set search_path=public
as $$
declare v_rol uuid;
begin
  select id into v_rol from public.roles
  where nombre = case when lower(new.email)='yohan_mendoza@outlook.com' then 'Superadministrador' else 'Promotor' end;
  insert into public.perfiles(id,nombre_completo,correo,rol_id)
  values(new.id,coalesce(new.raw_user_meta_data->>'nombre_completo',split_part(new.email,'@',1)),lower(new.email),v_rol)
  on conflict(id) do nothing;
  return new;
end;
$$;
drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users for each row execute procedure public.crear_perfil_nuevo();

create or replace function public.actualizar_fecha()
returns trigger language plpgsql as $$
begin new.updated_at=now(); new.modificado_por=auth.uid(); return new; end;
$$;
drop trigger if exists pacientes_actualizar_fecha on public.pacientes;
create trigger pacientes_actualizar_fecha before update on public.pacientes for each row execute procedure public.actualizar_fecha();

alter table public.roles enable row level security;
alter table public.permisos enable row level security;
alter table public.roles_permisos enable row level security;
alter table public.perfiles enable row level security;
alter table public.usuarios_permisos enable row level security;
alter table public.pacientes enable row level security;
alter table public.bitacora enable row level security;

create policy "roles lectura autenticada" on public.roles for select to authenticated using (true);
create policy "permisos lectura autenticada" on public.permisos for select to authenticated using (true);
create policy "roles permisos lectura autenticada" on public.roles_permisos for select to authenticated using (true);
create policy "perfil propio lectura" on public.perfiles for select to authenticated using (id=auth.uid() or public.tiene_permiso('usuarios.ver'));
create policy "perfil propio edicion" on public.perfiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy "usuarios permisos propios" on public.usuarios_permisos for select to authenticated using (usuario_id=auth.uid() or public.tiene_permiso('permisos.administrar'));
create policy "pacientes lectura" on public.pacientes for select to authenticated using (public.tiene_permiso('pacientes.ver'));
create policy "pacientes creacion" on public.pacientes for insert to authenticated with check (public.tiene_permiso('pacientes.crear') and creado_por=auth.uid());
create policy "pacientes edicion" on public.pacientes for update to authenticated using (public.tiene_permiso('pacientes.editar')) with check (public.tiene_permiso('pacientes.editar'));
create policy "bitacora lectura" on public.bitacora for select to authenticated using (public.tiene_permiso('bitacora.ver'));

grant usage on schema public to authenticated;
grant select on public.roles,public.permisos,public.roles_permisos to authenticated;
grant select,update on public.perfiles to authenticated;
grant select on public.usuarios_permisos to authenticated;
grant select,insert,update on public.pacientes to authenticated;
grant select on public.bitacora to authenticated;

notify pgrst,'reload schema';
