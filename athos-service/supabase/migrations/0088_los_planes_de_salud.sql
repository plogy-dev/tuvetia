-- Planes de salud: el paquete de servicios que una clínica le vende a un paciente.
--
-- ── DE DÓNDE SALE ─────────────────────────────────────────────────────────────────────────────
--
-- David, 25-ago: «planes de salud […] es como básicamente un plan personalizado por paciente». Es
-- lo que el mercado llama plan de bienestar: la clínica arma un paquete —3 consultas + 2 vacunas +
-- 1 desparasitación al año por $X— y se lo vende al titular de una mascota concreta.
--
-- ── CUATRO TABLAS, Y CADA UNA RESPONDE UNA PREGUNTA DISTINTA ──────────────────────────────────
--
--   `health_plans`          ¿qué planes ofrece esta clínica?
--   `health_plan_items`     ¿qué incluye cada plan, y cuánto de cada cosa?
--   `patient_health_plans`  ¿qué plan tiene ESTE paciente, y hasta cuándo?
--   `health_plan_uses`      ¿qué ya consumió, y en qué factura?
--
-- Se separa el PLAN de la CONTRATACIÓN porque son cosas distintas que cambian a ritmos distintos:
-- el plan se edita (sube el precio, se agrega un servicio) y la contratación es un hecho pasado que
-- no puede moverse porque alguien editó el catálogo.
--
-- ── LO QUE INCLUYE UN PLAN SALE DEL CATÁLOGO QUE YA EXISTE ────────────────────────────────────
--
-- `health_plan_items.catalog_item_id` apunta a `catalog_items`. NO se inventa una lista de
-- servicios paralela: si «Consulta general» se llama así en el catálogo, se llama así en el plan, y
-- cuando la clínica le cambie el nombre cambia en los dos lados. Una segunda lista de servicios es
-- una que se desincroniza el primer día.
--
-- Y es también lo que permite el enganche con facturación: la línea de la cuenta ya trae
-- `catalog_item_id`, así que saber si el plan la cubre es comparar ese id.
--
-- ── EL PRECIO SE CONGELA AL CONTRATAR ─────────────────────────────────────────────────────────
--
-- `patient_health_plans.price_cents` es una COPIA del precio del plan en el momento de contratarlo,
-- no una lectura. Es la misma decisión que ya toma `invoice_lines` con el precio del catálogo, y
-- por la misma razón: subirle el precio a un plan no puede cambiar retroactivamente lo que paga
-- quien lo compró en marzo.
--
-- ── UN CONSUMO NO PUEDE EXCEDER LO INCLUIDO, Y ESO LO SOSTIENE LA BASE ────────────────────────
--
-- El tope vive en un trigger y no sólo en la pantalla porque es PLATA: un plan que deja consumir
-- cuatro consultas de tres es un servicio regalado que nadie factura y nadie nota hasta que las
-- cuentas del mes no cuadran. La pantalla también lo comprueba —para dar el mensaje en español— y
-- ésta es la red de abajo.
--
-- El trigger toma `FOR UPDATE` sobre la contratación: dos cuentas abiertas en dos pestañas para el
-- mismo paciente leerían las dos «queda 1» y escribirían las dos. Es la misma carrera que la 0079
-- cerró en las notas crédito.
--
-- Aplicar en el principal (`auxlnexhkmtoedrzfsnz`). Reversible: se borran las cuatro tablas.

-- ── 1. EL PLAN QUE OFRECE LA CLÍNICA ─────────────────────────────────────────────────────────

create table if not exists public.health_plans (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  name          text not null,
  description   text,
  price_cents   bigint not null default 0,
  -- Cuánto dura desde que se contrata. En MESES porque así se venden ("plan anual", "semestral") y
  -- porque en días habría que decidir si un año son 365 o 366.
  months        integer not null default 12,
  active        boolean not null default true,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint health_plans_precio_no_negativo check (price_cents >= 0),
  constraint health_plans_vigencia_razonable check (months between 1 and 60)
);

create index if not exists health_plans_clinic_idx on public.health_plans (clinic_id, active);

-- ── 2. QUÉ INCLUYE ───────────────────────────────────────────────────────────────────────────

create table if not exists public.health_plan_items (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references public.health_plans(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id) on delete restrict,
  -- Cuántas veces entra ese servicio en el plan.
  qty             integer not null default 1,
  created_at      timestamptz not null default now(),
  constraint health_plan_items_cantidad_positiva check (qty > 0),
  -- El mismo servicio dos veces en el mismo plan sería ambiguo: ¿son 2+3 o se pisan? Se resuelve
  -- obligando a una sola fila por servicio, con su cantidad.
  constraint health_plan_items_sin_repetir unique (plan_id, catalog_item_id)
);

-- `on delete restrict` en el catálogo: borrar un servicio que está adentro de un plan dejaría el
-- plan prometiendo algo que ya no existe. Primero se saca del plan.

-- ── 3. EL PLAN DE UN PACIENTE ────────────────────────────────────────────────────────────────

create table if not exists public.patient_health_plans (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  patient_id    uuid not null references public.patients(id) on delete cascade,
  plan_id       uuid not null references public.health_plans(id) on delete restrict,
  -- Copia, no lectura. Ver el comentario de arriba.
  price_cents   bigint not null default 0,
  starts_on     date not null default current_date,
  ends_on       date not null,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  constraint patient_health_plans_vigencia check (ends_on > starts_on)
);

create index if not exists patient_health_plans_paciente_idx
  on public.patient_health_plans (patient_id, ends_on desc);

-- ── 4. LO CONSUMIDO ──────────────────────────────────────────────────────────────────────────

create table if not exists public.health_plan_uses (
  id                      uuid primary key default gen_random_uuid(),
  patient_health_plan_id  uuid not null references public.patient_health_plans(id) on delete cascade,
  catalog_item_id         uuid not null references public.catalog_items(id) on delete restrict,
  -- Dónde se usó. Nullable a propósito: un consumo puede registrarse a mano antes de facturar, y
  -- perder la traza sería peor que no tenerla atada.
  invoice_id              uuid references public.invoices(id) on delete set null,
  qty                     integer not null default 1,
  created_by              uuid references public.profiles(id),
  created_at              timestamptz not null default now(),
  constraint health_plan_uses_cantidad_positiva check (qty > 0)
);

create index if not exists health_plan_uses_contrato_idx
  on public.health_plan_uses (patient_health_plan_id, catalog_item_id);

-- ── EL TOPE, EN LA BASE ──────────────────────────────────────────────────────────────────────

create or replace function public.health_plan_uses_caben_en_el_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incluido  integer;
  v_usado     integer;
begin
  -- `FOR UPDATE` sobre la contratación: serializa a quien esté consumiendo del mismo plan. Sin
  -- esto, dos pestañas leen «queda 1» y las dos escriben.
  perform 1 from public.patient_health_plans where id = new.patient_health_plan_id for update;

  select coalesce(i.qty, 0) into v_incluido
    from public.patient_health_plans php
    join public.health_plan_items i
      on i.plan_id = php.plan_id and i.catalog_item_id = new.catalog_item_id
   where php.id = new.patient_health_plan_id;

  if v_incluido is null or v_incluido = 0 then
    raise exception 'Ese servicio no está incluido en el plan del paciente';
  end if;

  select coalesce(sum(qty), 0) into v_usado
    from public.health_plan_uses
   where patient_health_plan_id = new.patient_health_plan_id
     and catalog_item_id = new.catalog_item_id
     and id is distinct from new.id;

  if v_usado + new.qty > v_incluido then
    raise exception 'El plan incluye % de ese servicio y ya se usaron %', v_incluido, v_usado;
  end if;

  return new;
end $$;

drop trigger if exists health_plan_uses_caben on public.health_plan_uses;
create trigger health_plan_uses_caben
  before insert or update on public.health_plan_uses
  for each row execute function public.health_plan_uses_caben_en_el_plan();

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────
--
-- Se usa `private.my_clinic_id()`, que es lo que ya usan `patients`, `appointments` y
-- `catalog_items`. NO una subconsulta a `profiles`: además de repetir lo que esa función encapsula,
-- una policy que consulta `profiles` en cada fila es la que aparece después en `pg_stat_statements`.
--
-- Las dos tablas con `clinic_id` se acotan directo. Las otras dos cuelgan por FK y heredan el
-- alcance del EXISTS — es lo mismo que hace `invoice_lines` con su factura.

alter table public.health_plans enable row level security;
alter table public.health_plan_items enable row level security;
alter table public.patient_health_plans enable row level security;
alter table public.health_plan_uses enable row level security;

drop policy if exists health_plans_por_clinica on public.health_plans;
create policy health_plans_por_clinica on public.health_plans
  for all to authenticated
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists patient_health_plans_por_clinica on public.patient_health_plans;
create policy patient_health_plans_por_clinica on public.patient_health_plans
  for all to authenticated
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists health_plan_items_por_plan on public.health_plan_items;
create policy health_plan_items_por_plan on public.health_plan_items
  for all to authenticated
  using (exists (
    select 1 from public.health_plans p
     where p.id = plan_id and p.clinic_id = (select private.my_clinic_id())
  ))
  with check (exists (
    select 1 from public.health_plans p
     where p.id = plan_id and p.clinic_id = (select private.my_clinic_id())
  ));

drop policy if exists health_plan_uses_por_contrato on public.health_plan_uses;
create policy health_plan_uses_por_contrato on public.health_plan_uses
  for all to authenticated
  using (exists (
    select 1 from public.patient_health_plans php
     where php.id = patient_health_plan_id and php.clinic_id = (select private.my_clinic_id())
  ))
  with check (exists (
    select 1 from public.patient_health_plans php
     where php.id = patient_health_plan_id and php.clinic_id = (select private.my_clinic_id())
  ));

comment on table public.health_plans is
  'Planes de salud (bienestar) que ofrece la clínica. Lo que incluye cada uno vive en health_plan_items, apuntando al catálogo.';
comment on column public.patient_health_plans.price_cents is
  'COPIA del precio al contratar, no una lectura del plan: subirle el precio a un plan no cambia lo que paga quien ya lo tiene.';
comment on table public.health_plan_uses is
  'Lo consumido de un plan. El trigger health_plan_uses_caben impide pasarse de lo incluido — es plata, y no puede sostenerlo sólo la pantalla.';
