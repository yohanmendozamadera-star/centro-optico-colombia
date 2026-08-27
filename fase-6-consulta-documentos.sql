-- Fase 6: Consulta optométrica y documentos privados

insert into public.permisos(codigo,modulo,accion,descripcion) values
('consultas.ver','consultas','ver','Consultar información clínica'),
('consultas.crear','consultas','crear','Registrar consultas optométricas'),
('consultas.editar','consultas','editar','Editar consultas optométricas'),
('documentos_clinicos.ver','documentos_clinicos','ver','Consultar documentos clínicos'),
('documentos_clinicos.cargar','documentos_clinicos','cargar','Cargar documentos clínicos')
on conflict (codigo) do nothing;

insert into public.roles_permisos(rol_id,permiso_id)
select r.id,p.id from public.roles r cross join public.permisos p
where r.nombre in ('Superadministrador','Propietario')
and p.modulo in ('consultas','documentos_clinicos')
on conflict do nothing;

create table if not exists public.consultas_optometricas (
  id uuid primary key default gen_random_uuid(),
  agendamiento_id uuid not null unique references public.agendamientos(id),
  paciente_id uuid not null references public.pacientes(id),
  jornada_id uuid not null references public.jornadas(id),
  brigada_id uuid references public.brigadas(id),
  optometra text not null,
  diagnostico text not null,
  formula_od jsonb not null default '{}'::jsonb,
  formula_oi jsonb not null default '{}'::jsonb,
  distancia_pupilar text,
  tipo_lente_recomendado text,
  recomendaciones text,
  observaciones text,
  proximo_control date,
  registrado_por uuid not null default auth.uid() references public.perfiles(id),
  modificado_por uuid references public.perfiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists consultas_paciente_idx on public.consultas_optometricas(paciente_id,created_at desc);

create table if not exists public.documentos_consulta (
  id uuid primary key default gen_random_uuid(),
  consulta_id uuid not null references public.consultas_optometricas(id) on delete cascade,
  paciente_id uuid not null references public.pacientes(id),
  ruta_archivo text not null unique,
  nombre_archivo text not null,
  tipo_archivo text,
  tamano_bytes bigint check(tamano_bytes is null or tamano_bytes>=0),
  cargado_por uuid not null default auth.uid() references public.perfiles(id),
  created_at timestamptz not null default now()
);
create index if not exists documentos_consulta_idx on public.documentos_consulta(consulta_id);

drop trigger if exists consultas_actualizar_fecha on public.consultas_optometricas;
create trigger consultas_actualizar_fecha before update on public.consultas_optometricas for each row execute procedure public.actualizar_fecha();
drop trigger if exists consultas_auditoria on public.consultas_optometricas;
create trigger consultas_auditoria after insert or update or delete on public.consultas_optometricas for each row execute procedure public.auditar_cambio();

alter table public.consultas_optometricas enable row level security;
alter table public.documentos_consulta enable row level security;
create policy "consultas lectura" on public.consultas_optometricas for select to authenticated using(public.tiene_permiso('consultas.ver'));
create policy "consultas creacion" on public.consultas_optometricas for insert to authenticated with check(public.tiene_permiso('consultas.crear') and registrado_por=auth.uid());
create policy "consultas edicion" on public.consultas_optometricas for update to authenticated using(public.tiene_permiso('consultas.editar'));
create policy "documentos lectura" on public.documentos_consulta for select to authenticated using(public.tiene_permiso('documentos_clinicos.ver'));
create policy "documentos carga" on public.documentos_consulta for insert to authenticated with check(public.tiene_permiso('documentos_clinicos.cargar') and cargado_por=auth.uid());
grant select,insert,update on public.consultas_optometricas to authenticated;
grant select,insert on public.documentos_consulta to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('documentos-clinicos','documentos-clinicos',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;

create policy "storage clinico lectura" on storage.objects for select to authenticated
using(bucket_id='documentos-clinicos' and public.tiene_permiso('documentos_clinicos.ver'));
create policy "storage clinico carga" on storage.objects for insert to authenticated
with check(bucket_id='documentos-clinicos' and public.tiene_permiso('documentos_clinicos.cargar') and (storage.foldername(name))[1]=auth.uid()::text);

notify pgrst,'reload schema';
