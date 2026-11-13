import { writeFile } from "node:fs/promises";

const source = "https://www.datos.gov.co/resource/gdxc-w37w.json?$limit=5000&$order=cod_mpio";
const response = await fetch(source);
if (!response.ok) throw new Error(`No fue posible descargar DIVIPOLA: ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length < 1100) throw new Error(`El catálogo llegó incompleto: ${rows?.length || 0} registros`);

const clean = value => String(value ?? "").trim();
const sqlText = value => `'${clean(value).replaceAll("'", "''")}'`;
const normalize = value => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const municipalities = rows.map(row => ({
  codigo: clean(row.cod_mpio).padStart(5, "0"),
  departamento_codigo: clean(row.cod_dpto).padStart(2, "0"),
  departamento: clean(row.dpto),
  nombre: clean(row.nom_mpio),
  tipo: clean(row.tipo_municipio || "Municipio"),
  nombre_busqueda: normalize(`${row.nom_mpio} ${row.dpto} ${row.cod_mpio}`),
}));
const unique = new Map(municipalities.map(row => [row.codigo, row]));
if (unique.size !== municipalities.length) throw new Error("El catálogo oficial contiene códigos municipales duplicados");

const values = [...unique.values()].map(row => `(${sqlText(row.codigo)},${sqlText(row.departamento_codigo)},${sqlText(row.departamento)},${sqlText(row.nombre)},${sqlText(row.tipo)},${sqlText(row.nombre_busqueda)},true)`).join(",\n");
const sql = `-- Catálogo oficial DIVIPOLA suministrado por DANE / datos.gov.co
-- Fuente: ${source}
-- Registros: ${unique.size}

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.municipios_dane (
  codigo text primary key check (codigo ~ '^[0-9]{5}$'),
  departamento_codigo text not null check (departamento_codigo ~ '^[0-9]{2}$'),
  departamento text not null,
  nombre text not null,
  tipo text not null default 'Municipio',
  nombre_busqueda text not null,
  activo boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.municipios_dane enable row level security;
drop policy if exists municipios_dane_lectura_autenticada on public.municipios_dane;
create policy municipios_dane_lectura_autenticada on public.municipios_dane
for select to authenticated using (activo = true);
grant select on public.municipios_dane to authenticated;
revoke insert, update, delete on public.municipios_dane from anon, authenticated;

create index if not exists municipios_dane_busqueda_trgm_idx
on public.municipios_dane using gin (nombre_busqueda extensions.gin_trgm_ops);
create index if not exists municipios_dane_departamento_idx
on public.municipios_dane (departamento_codigo, nombre);

alter table public.pacientes add column if not exists municipio_codigo text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pacientes_municipio_codigo_fkey') then
    alter table public.pacientes add constraint pacientes_municipio_codigo_fkey
      foreign key (municipio_codigo) references public.municipios_dane(codigo);
  end if;
end $$;
create index if not exists pacientes_municipio_codigo_idx on public.pacientes(municipio_codigo);

insert into public.municipios_dane (codigo,departamento_codigo,departamento,nombre,tipo,nombre_busqueda,activo)
values
${values}
on conflict (codigo) do update set
  departamento_codigo = excluded.departamento_codigo,
  departamento = excluded.departamento,
  nombre = excluded.nombre,
  tipo = excluded.tipo,
  nombre_busqueda = excluded.nombre_busqueda,
  activo = true,
  updated_at = now();
`;

await writeFile(new URL("../fase-23-municipios-divipola.sql", import.meta.url), sql, "utf8");
console.log(JSON.stringify({ registros: unique.size, primero: [...unique.values()][0], ultimo: [...unique.values()].at(-1) }));
