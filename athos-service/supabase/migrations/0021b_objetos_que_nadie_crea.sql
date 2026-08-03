-- Los objetos que las migraciones ASUMEN y ninguna CREA.
--
-- EL PROBLEMA. Un `db push` sobre una base limpia muere en la línea 18 de la 0022:
--
--     alter table public.memberships alter column role drop default;
--     ERROR:  relation "public.memberships" does not exist
--
-- `memberships` nació out-of-band en julio, aplicada a mano al principal y nunca escrita en el repo
-- — la propia 0022 lo admite en su cabecera ("ya existia en la BD viva"). Lo mismo con el tipo
-- `clinic_role` que esa migración convierte y dropea, y con las RPC `create_owner`/`create_patient`
-- a las que la 0026 les revoca privilegios.
--
-- Barrido cruzado completo de `alter`/`drop policy`/`grant`/`revoke` contra todos los `create` del
-- repo: son exactamente estos cuatro objetos, más la unique de memberships. No hay más.
--
-- CONSECUENCIA. Las 32 migraciones posteriores a la 0022 **nunca se han ejecutado desde cero**, y
-- `docs/MIGRACIONES.md` documenta la reconstrucción con `ON_ERROR_STOP=1`: ese runbook no puede
-- haber funcionado desde el 2026-07-27. Levantar un dev nuevo es imposible hoy.
--
-- ESTA MIGRACIÓN ES UN NO-OP EXACTO SOBRE EL PRINCIPAL. Todo va dentro de un
-- `if to_regclass('public.memberships') is null`, o sea que sólo hace algo cuando de verdad se está
-- reconstruyendo desde cero. Importa: en el principal `clinic_role` YA fue dropeado por la 0022, y
-- recrearlo dejaría un tipo huérfano.
--
-- Se crea la tabla como la esperaba la 0022 —con `role clinic_role`, que ella misma convierte a
-- `user_role`— y SIN las claves foráneas ni el índice, porque la 0022 los agrega con nombre fijo y
-- un `add constraint` duplicado falla. Sí se habilita RLS acá: la 0022 crea las dos policies pero
-- nunca la habilita, y una policy sobre una tabla sin RLS no protege nada.
--
-- La forma sale del principal, que es la única fuente que existe: columnas, defaults y la unique
-- `memberships_clinic_id_user_id_key` verificadas contra `information_schema` y `pg_constraint`.
do $$
begin
  if to_regclass('public.memberships') is not null then
    raise notice '0021b: memberships ya existe — no hay nada que hacer (esto es lo normal en el principal)';
    return;
  end if;

  create type public.clinic_role as enum ('owner', 'vet');

  create table public.memberships (
    id         uuid primary key default gen_random_uuid(),
    clinic_id  uuid not null,
    user_id    uuid not null,
    role       public.clinic_role not null default 'vet',
    created_at timestamptz not null default now(),
    -- La 0022 hace `on conflict (clinic_id, user_id)` en tres sitios: sin esta unique, el upsert
    -- de `accept_invitation` falla en caliente, no al migrar.
    unique (clinic_id, user_id)
  );

  -- Las FKs y el índice los agrega la 0022 con nombres fijos; duplicarlos acá la rompería.
  alter table public.memberships enable row level security;
end $$;

-- ── Las dos RPC que la 0026 revoca y ninguna migración define ────────────────────────────────────
--
-- Cuerpo tomado del principal (`pg_proc.prosrc`), que es donde vivían. Son correctas: derivan la
-- clínica de `private.my_clinic_id()` en vez de recibirla por parámetro, y `create_patient` verifica
-- que el titular sea de esa misma clínica. Se escriben acá para que el repo tenga su fuente, no
-- porque haya que arreglarlas.
--
-- `create or replace` a propósito: sobre el principal reescribe lo mismo y no cambia nada.
create or replace function public.create_owner(
  p_full_name   text,
  p_phone       text,
  p_email       text,
  p_document_id text,
  p_address     text,
  p_notes       text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_owner_id uuid;
  v_clinic_id uuid := private.my_clinic_id();
begin
  if v_clinic_id is null then
    raise exception 'No clinic assigned to current user';
  end if;

  insert into public.owners (clinic_id, full_name, phone, email, document_id, address, notes)
  values (
    v_clinic_id,
    p_full_name,
    nullif(p_phone, ''),
    nullif(p_email, ''),
    nullif(p_document_id, ''),
    nullif(p_address, ''),
    nullif(p_notes, '')
  )
  returning id into new_owner_id;

  return new_owner_id;
end;
$function$;

create or replace function public.create_patient(
  p_owner_id   uuid,
  p_name       text,
  p_species    text,
  p_sex        public.patient_sex,
  p_breed      text,
  p_birth_date date,
  p_weight_kg  numeric
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_patient_id uuid;
  v_clinic_id uuid := private.my_clinic_id();
begin
  if v_clinic_id is null then
    raise exception 'No clinic assigned to current user';
  end if;

  if not exists (
    select 1 from public.owners
    where id = p_owner_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Owner does not belong to your clinic';
  end if;

  insert into public.patients (clinic_id, owner_id, name, species, sex, breed, birth_date, weight_kg)
  values (v_clinic_id, p_owner_id, p_name, p_species, p_sex, nullif(p_breed, ''), p_birth_date, p_weight_kg)
  returning id into new_patient_id;

  return new_patient_id;
end;
$function$;

-- ── La prueba de que esto sirvió ────────────────────────────────────────────────────────────────
-- Sobre un proyecto de DEV vacío, correr todas las migraciones en orden con ON_ERROR_STOP=1 tiene
-- que llegar hasta la última sin parar. Es lo que nunca se ha podido hacer.
