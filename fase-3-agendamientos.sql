-- Fase 3: Agendamientos, estados y movimientos financieros
-- Ejecutar después de fase-2-jornadas-brigadas.sql

insert into public.permisos(codigo,modulo,accion,descripcion) values
('agenda.ver','agenda','ver','Consultar agenda'),
('agenda.crear','agenda','crear','Crear agendamientos'),
('agenda.editar','agenda','editar','Editar agendamientos'),
('agenda.confirmar','agenda','confirmar','Confirmar citas'),
('pagos.registrar','pagos','registrar','Registrar abonos y pagos'),
('pagos.ver','pagos','ver','Consultar movimientos financieros')
on conflict (codigo) do nothing;

insert into public.roles_permisos(rol_id,permiso_id)
select r.id,p.id from public.roles r cross join public.permisos p
where r.nombre in ('Superadministrador','Propietario')
and p.modulo in ('agenda','pagos')
on conflict do nothing;

create table if not exists public.estados_cita (
  codigo text primary key,
  nombre text not null,
  color text not null,
  orden integer not null,
  activo boolean not null default true
);
insert into public.estados_cita(codigo,nombre,color,orden) values
('registrada','Cita registrada','#73788a',1),
('confirmada','Cita confirmada','#d39b12',2),
('cumplida','Cita cumplida','#178a65',3),
('incumplida','Cita incumplida','#c83e4b',4),
('cancelada','Cita cancelada','#8d2530',5),
('reprogramada','Cita reprogramada','#7654c4',6)
on conflict (codigo) do nothing;

create table if not exists public.agendamientos (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id),
  jornada_id uuid not null references public.jornadas(id),
  brigada_id uuid references public.brigadas(id),
  numero_volante text not null,
  valor_consulta numeric(12,2) not null check(valor_consulta>=0),
  saldo_favor_aplicado numeric(12,2) not null default 0 check(saldo_favor_aplicado>=0),
  abono numeric(12,2) not null default 0 check(abono>=0),
  saldo_pendiente numeric(12,2) generated always as (greatest(valor_consulta-saldo_favor_aplicado-abono,0)) stored,
  recurso_id uuid not null default auth.uid() references public.perfiles(id),
  estado text not null default 'registrada' references public.estados_cita(codigo),
  canal_registro text not null default 'administracion',
  observaciones text,
  activo boolean not null default true,
  creado_por uuid not null default auth.uid() references public.perfiles(id),
  modificado_por uuid references public.perfiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint volante_unico_jornada unique(jornada_id,numero_volante),
  constraint abono_valido check(abono+saldo_favor_aplicado<=valor_consulta)
);
create index if not exists agendamientos_paciente_idx on public.agendamientos(paciente_id);
create index if not exists agendamientos_jornada_idx on public.agendamientos(jornada_id);
create index if not exists agendamientos_estado_idx on public.agendamientos(estado);
create index if not exists agendamientos_fecha_idx on public.agendamientos(created_at);

create table if not exists public.movimientos_financieros (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id),
  jornada_id uuid references public.jornadas(id),
  brigada_id uuid references public.brigadas(id),
  agendamiento_id uuid references public.agendamientos(id),
  tipo text not null check(tipo in ('abono_agendamiento','pago_brigada','aplicacion_saldo_favor','devolucion','ajuste','anulacion')),
  valor numeric(12,2) not null check(valor>=0),
  metodo_pago text not null default 'efectivo',
  canal text not null default 'administracion',
  recibido_por uuid not null default auth.uid() references public.perfiles(id),
  estado text not null default 'activo' check(estado in ('activo','anulado')),
  observaciones text,
  created_at timestamptz not null default now()
);
create index if not exists movimientos_agendamiento_idx on public.movimientos_financieros(agendamiento_id);
create index if not exists movimientos_paciente_idx on public.movimientos_financieros(paciente_id);

create or replace function public.registrar_agendamiento(
  p_paciente uuid,p_jornada uuid,p_brigada uuid,p_volante text,p_valor numeric,
  p_saldo_favor numeric,p_abono numeric,p_estado text,p_observaciones text
) returns uuid language plpgsql security invoker set search_path=public as $$
declare v_id uuid;
begin
  insert into public.agendamientos(paciente_id,jornada_id,brigada_id,numero_volante,valor_consulta,saldo_favor_aplicado,abono,estado,observaciones)
  values(p_paciente,p_jornada,p_brigada,p_volante,p_valor,coalesce(p_saldo_favor,0),coalesce(p_abono,0),p_estado,p_observaciones)
  returning id into v_id;
  if coalesce(p_abono,0)>0 then
    insert into public.movimientos_financieros(paciente_id,jornada_id,brigada_id,agendamiento_id,tipo,valor)
    values(p_paciente,p_jornada,p_brigada,v_id,'abono_agendamiento',p_abono);
  end if;
  return v_id;
end;$$;

drop trigger if exists agendamientos_actualizar_fecha on public.agendamientos;
create trigger agendamientos_actualizar_fecha before update on public.agendamientos for each row execute procedure public.actualizar_fecha();
drop trigger if exists agendamientos_auditoria on public.agendamientos;
create trigger agendamientos_auditoria after insert or update or delete on public.agendamientos for each row execute procedure public.auditar_cambio();
drop trigger if exists movimientos_auditoria on public.movimientos_financieros;
create trigger movimientos_auditoria after insert or update or delete on public.movimientos_financieros for each row execute procedure public.auditar_cambio();

alter table public.estados_cita enable row level security;
alter table public.agendamientos enable row level security;
alter table public.movimientos_financieros enable row level security;
create policy "estados lectura" on public.estados_cita for select to authenticated using(true);
create policy "agenda lectura" on public.agendamientos for select to authenticated using(public.tiene_permiso('agenda.ver'));
create policy "agenda creacion" on public.agendamientos for insert to authenticated with check(public.tiene_permiso('agenda.crear') and creado_por=auth.uid());
create policy "agenda edicion" on public.agendamientos for update to authenticated using(public.tiene_permiso('agenda.editar')) with check(public.tiene_permiso('agenda.editar'));
create policy "movimientos lectura" on public.movimientos_financieros for select to authenticated using(public.tiene_permiso('pagos.ver'));
create policy "movimientos creacion" on public.movimientos_financieros for insert to authenticated with check(public.tiene_permiso('pagos.registrar') and recibido_por=auth.uid());
grant select on public.estados_cita to authenticated;
grant select,insert,update on public.agendamientos to authenticated;
grant select,insert on public.movimientos_financieros to authenticated;
grant execute on function public.registrar_agendamiento(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text) to authenticated;
notify pgrst,'reload schema';
