-- 0090 — El catálogo de vacunas de la clínica: la primera «Variable» de OkVet que se construye.
--
-- ── DE DÓNDE SALE ─────────────────────────────────────────────────────────────────────────────
--
-- David, 25-ago: el admin panel necesita «Variables» (los catálogos clínicos de OkVet: consultas,
-- vacunas, cirugías, laboratorio…). Se decidió empezar por VACUNAS y no por los ocho a la vez,
-- porque es el único catálogo cuyo dato ya trabaja: `vaccines` registra aplicaciones, el tablero
-- cuenta las por vencer, y los avisos a titulares tienen el segmento de vacuna vencida.
--
-- ── QUÉ ARREGLA ───────────────────────────────────────────────────────────────────────────────
--
-- Hoy `vaccines.vaccine_name` es texto libre: «Rabia», «rabia » y «Vacuna antirrábica» son tres
-- vacunas distintas para cualquier conteo, y el segmento de vencidas agrupa por nombre — cada
-- variante arma su propio grupo. El catálogo da la lista de la clínica para ELEGIR en vez de
-- teclear. `vaccine_name` sigue siendo texto (los meses de datos ya escritos no se migran ni se
-- rompen); el catálogo alimenta el selector, no reemplaza la columna.
--
-- Aplicar en el principal (`auxlnexhkmtoedrzfsnz`). Reversible: drop de la tabla.

create table if not exists public.vaccine_types (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  name        text not null,
  -- A qué especie aplica, texto libre y opcional («Perro», «Gato»); null = todas. Es una AYUDA
  -- del selector, no una restricción: la base no impide aplicar una vacuna felina a un perro
  -- porque quien sabe eso es el vet, no un constraint.
  species     text,
  active      boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  constraint vaccine_types_nombre_no_vacio check (length(trim(name)) > 0)
);

-- Sin duplicados POR NOMBRE NORMALIZADO: «Rabia» y «rabia » son la misma vacuna, y dos filas
-- iguales en el selector es el mismo bug del texto libre con más pasos.
create unique index if not exists vaccine_types_nombre_unico
  on public.vaccine_types (clinic_id, lower(trim(name)));

alter table public.vaccine_types enable row level security;

drop policy if exists vaccine_types_por_clinica on public.vaccine_types;
create policy vaccine_types_por_clinica on public.vaccine_types
  for all to authenticated
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

comment on table public.vaccine_types is
  'Catálogo de vacunas de la clínica (Variables, fase 1). Alimenta el selector del alta de vacunas; vaccines.vaccine_name sigue siendo texto para no romper lo ya escrito.';
