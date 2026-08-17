-- Un veterinario no puede quedar con dos citas encima, salvo que alguien lo decida a propósito.
--
-- EL REPORTE Y SU CONFIRMACIÓN. David contó que a veces quedan citas sobrepuestas. Medido contra el
-- principal el 2026-08-17: **6 pares de citas se solapan, y los 6 son del MISMO veterinario**. Ni un
-- solo caso de vets distintos, que sería legítimo. No es una impresión: es un defecto con datos.
--
-- NO HABÍA GUARDA EN NINGUNA CAPA. Ni restricción en la base, ni chequeo en `create_appointment`
-- —que valida otras siete cosas—, ni en el calendario. Athos SÍ consulta huecos libres antes de
-- proponer, pero eso es una instrucción del prompt: una preferencia, no una garantía.
--
-- ── POR QUÉ UN TRIGGER Y NO UN CHEQUEO EN LOS RPC ───────────────────────────────────────────────
--
-- Porque el RPC no es el único camino de escritura. `appointment-calendar.tsx:243` hace un `update`
-- DIRECTO de `starts_at`/`ends_at`: es el arrastrar-y-soltar del calendario, y se salta
-- `update_appointment` entero. Una guarda en las funciones dejaría abierta justo la vía por la que
-- más fácil se produce el solape — arrastrando una cita encima de otra.
--
-- El trigger cubre las tres vías que existen hoy (los dos RPC y el update directo) y la cuarta que
-- alguien escriba mañana sin leer esto.
--
-- ── POR QUÉ NO UNA RESTRICCIÓN DE EXCLUSIÓN ────────────────────────────────────────────────────
--
-- Un `EXCLUDE USING gist` sería más fuerte, y por eso mismo no sirve acá: haría el solape
-- FÍSICAMENTE IMPOSIBLE. Y una clínica sí necesita solapar a veces — entra una urgencia mientras el
-- vet está en consulta. Prohibirlo del todo no elimina el caso: lo empuja fuera del sistema, a un
-- papel, que es peor que tenerlo registrado.
--
-- Además la restricción no se podría ni aplicar: las 6 filas que ya se solapan la violarían.
--
-- ── LA VÁLVULA: `permite_solape` ───────────────────────────────────────────────────────────────
--
-- Una columna en la propia cita, y no un parámetro de función, porque así la decisión QUEDA
-- ESCRITA: se puede responder después "¿esta cita se agendó encima de otra a propósito?". Un
-- parámetro se evapora al terminar la llamada.
--
-- Por defecto `false`: el accidente se bloquea y lo deliberado exige decirlo.
--
-- ── QUÉ CUENTA COMO OCUPADO ────────────────────────────────────────────────────────────────────
--
-- `scheduled`, `confirmed` e `in_progress` — exactamente el mismo conjunto que `ESTADOS_VIVOS` en
-- `calendario/page.tsx:16`. Se copia a propósito en vez de inventar otro: dos definiciones de "cita
-- viva" que discrepen producirían una agenda que muestra una cosa y una base que impide otra.
--
-- `canceled` y `no_show` no ocupan. `completed` tampoco: es pasado, y bloquear por ella impediría
-- corregir el histórico.

-- ---------------------------------------------------------------------------
-- 1. La válvula
-- ---------------------------------------------------------------------------

alter table public.appointments
  add column if not exists permite_solape boolean not null default false;

comment on column public.appointments.permite_solape is
  'Marca que esta cita se agendo ENCIMA de otra del mismo veterinario a proposito (una urgencia). '
  'Por defecto false: el solape accidental se bloquea y el deliberado queda registrado.';

-- LAS 6 QUE YA SE SOLAPAN se marcan como deliberadas. No es maquillaje: si no, editarles el titulo
-- a cualquiera de ellas fallaria con un conflicto que el usuario no causo, y la migracion se
-- convertiria en una mina. Quedan visibles y consultables por esta misma columna.
update public.appointments a
set permite_solape = true
where a.status in ('scheduled','confirmed','in_progress')
  and a.vet_id is not null
  and exists (
    select 1 from public.appointments b
    where b.clinic_id = a.clinic_id
      and b.id <> a.id
      and b.vet_id = a.vet_id
      and b.status in ('scheduled','confirmed','in_progress')
      and b.starts_at < a.ends_at
      and b.ends_at > a.starts_at
  );

-- ---------------------------------------------------------------------------
-- 2. El índice que hace barata la comprobación
-- ---------------------------------------------------------------------------

-- El trigger corre en CADA insert y update de citas, así que su consulta no puede ser un escaneo.
-- El índice que había es `(clinic_id, starts_at)` y no incluye el vet, que es justo por lo que esto
-- filtra primero.
create index if not exists appointments_vet_agenda_idx
  on public.appointments (clinic_id, vet_id, starts_at);

-- ---------------------------------------------------------------------------
-- 3. La guarda
-- ---------------------------------------------------------------------------

create or replace function private.impedir_solape_de_citas()
returns trigger
language plpgsql
security definer
-- `search_path` fijo: misma regla que el resto de `private.` — una SECURITY DEFINER sin esto se
-- puede secuestrar creando un objeto homónimo en un esquema que el llamador controle.
set search_path = public, pg_temp
as $$
declare
  v_choque record;
begin
  -- Las tres salidas tempranas, en orden de lo más barato a lo más específico.
  if new.permite_solape then return new; end if;
  if new.vet_id is null then return new; end if;
  if new.status not in ('scheduled', 'confirmed', 'in_progress') then return new; end if;

  select id, title, starts_at, ends_at
    into v_choque
  from public.appointments
  where clinic_id = new.clinic_id
    and vet_id    = new.vet_id
    and id       <> new.id                    -- en UPDATE, no choca consigo misma
    and status in ('scheduled', 'confirmed', 'in_progress')
    -- Solape de intervalos semiabiertos: dos citas pegadas (una termina 10:00 y la otra empieza
    -- 10:00) NO se solapan, que es lo que espera cualquier agenda.
    and starts_at < new.ends_at
    and ends_at   > new.starts_at
  limit 1;

  if found then
    -- El mensaje lleva la hora EN BOGOTÁ y el título de la otra cita: sin eso, el vet ve "hay un
    -- conflicto" y tiene que salir a buscar con cuál.
    raise exception
      'El veterinario ya tiene "%" de % a %. Si es a propósito (una urgencia), marca la cita como solapada.',
      coalesce(nullif(trim(v_choque.title), ''), 'otra cita'),
      to_char(v_choque.starts_at at time zone 'America/Bogota', 'HH24:MI'),
      to_char(v_choque.ends_at   at time zone 'America/Bogota', 'HH24:MI');
  end if;

  return new;
end;
$$;

comment on function private.impedir_solape_de_citas() is
  'Bloquea que un veterinario quede con dos citas vivas encima. Se salta con appointments.permite_solape. '
  'Es un trigger y no un chequeo en los RPC porque el calendario actualiza horarios en directo.';

drop trigger if exists appointments_sin_solape on public.appointments;
create trigger appointments_sin_solape
  before insert or update of starts_at, ends_at, vet_id, status, permite_solape
  on public.appointments
  for each row execute function private.impedir_solape_de_citas();
