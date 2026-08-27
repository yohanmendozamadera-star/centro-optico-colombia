-- Fase 4: Call Center CRM por jornada

insert into public.permisos(codigo,modulo,accion,descripcion) values
('call_center.ver','call_center','ver','Consultar CRM de Call Center'),
('call_center.gestionar','call_center','gestionar','Registrar llamadas y resultados'),
('call_center.confirmar','call_center','confirmar','Confirmar o cancelar citas')
on conflict (codigo) do nothing;

insert into public.roles_permisos(rol_id,permiso_id)
select r.id,p.id from public.roles r cross join public.permisos p
where r.nombre in ('Superadministrador','Propietario')
and p.modulo='call_center'
on conflict do nothing;

create table if not exists public.gestiones_call_center (
  id uuid primary key default gen_random_uuid(),
  agendamiento_id uuid not null references public.agendamientos(id) on delete cascade,
  resultado text not null check(resultado in ('contactado','confirmado','no_contesta','numero_equivocado','cancelado','reprogramar','whatsapp')),
  observaciones text,
  proximo_contacto timestamptz,
  usuario_id uuid not null default auth.uid() references public.perfiles(id),
  created_at timestamptz not null default now()
);
create index if not exists gestiones_agendamiento_idx on public.gestiones_call_center(agendamiento_id,created_at desc);
create index if not exists gestiones_proximo_contacto_idx on public.gestiones_call_center(proximo_contacto);

drop trigger if exists gestiones_call_center_auditoria on public.gestiones_call_center;
create trigger gestiones_call_center_auditoria after insert or update or delete on public.gestiones_call_center for each row execute procedure public.auditar_cambio();

alter table public.gestiones_call_center enable row level security;
create policy "call center lectura" on public.gestiones_call_center for select to authenticated using(public.tiene_permiso('call_center.ver'));
create policy "call center gestion" on public.gestiones_call_center for insert to authenticated with check(public.tiene_permiso('call_center.gestionar') and usuario_id=auth.uid());
grant select,insert on public.gestiones_call_center to authenticated;
notify pgrst,'reload schema';
