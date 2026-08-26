-- 0093: reservar un espacio sin paciente, y decir DE QUÉ es cada cita.
--
-- ── LO QUE SE PIDIÓ ─────────────────────────────────────────────────────────────────────────────
--
-- Del recorrido por OkVet (26-ago): su modal de crear evento tiene tres cosas que la agenda de
-- Tuvetia no tenía —«Sólo reservar el espacio», un desplegable de tipo de cita, y «Sin hora
-- definida»— y las tres cambian lo que se PUEDE agendar, no cómo se ve.
--
-- ── LA QUE CHOCA CON LA 0048, Y CÓMO SE RESUELVE ────────────────────────────────────────────────
--
-- «Sólo reservar el espacio» es una cita SIN paciente ni titular: un almuerzo, una cirugía todavía
-- sin dueño asignado, una ausencia. La 0048 hizo esos dos campos obligatorios en las RPC, a
-- propósito y después de que aparecieran citas huérfanas.
--
-- La salida NO es relajar la regla para todos: es marcar el caso. `es_bloqueo` dice «esto no es una
-- cita de un paciente», y sólo entonces la RPC deja pasar sin paciente ni titular. Para una cita
-- normal todo sigue igual de obligatorio que ayer — la garantía de la 0048 queda intacta donde
-- importa, que es en las citas de verdad.
--
-- UN BLOQUEO SIGUE OCUPANDO EL HORARIO. No se le hace ninguna excepción al antisolape de la 0067:
-- si el bloqueo tiene veterinario, ese veterinario está ocupado. Es todo el punto de reservar un
-- espacio — si no bloqueara, sería una nota.
--
-- ── `sin_hora`: EL DÍA COMPLETO, SIN TOCAR LAS COLUMNAS ─────────────────────────────────────────
--
-- `starts_at`/`ends_at` son NOT NULL y así se quedan. Hacerlos nulos obligaría a revisar cada
-- consulta que compara rangos —el barrido de recordatorios, los huecos, el antisolape, el feed ICS—
-- y cualquiera que se olvidara compararía contra null y devolvería vacío en silencio.
--
-- Una cita «sin hora definida» se guarda cubriendo el día en horario de Bogotá y se MARCA. La
-- marca es lo que deja pintarla como cita de día completo en vez de como un bloque de 24 horas que
-- tapa la grilla entera.

-- ── Las columnas ────────────────────────────────────────────────────────────────────────────────

alter table public.appointments
  add column if not exists es_bloqueo boolean not null default false,
  add column if not exists tipo text,
  add column if not exists sin_hora boolean not null default false;

comment on column public.appointments.es_bloqueo is
  'Reserva de espacio sin paciente ni titular (almuerzo, quirófano, ausencia). Es lo ÚNICO que '
  'exime de la obligatoriedad que impuso la 0048; sigue ocupando el horario del veterinario.';

comment on column public.appointments.tipo is
  'De qué es la cita: consulta_general, vacunacion, cirugia… Texto y no enum a propósito: cada '
  'clínica tiene los suyos y un enum obliga a una migración para agregar uno.';

comment on column public.appointments.sin_hora is
  'La cita es de día completo. `starts_at`/`ends_at` cubren el día en Bogotá igual, para no romper '
  'ninguna consulta que compare rangos.';

-- POR QUÉ `tipo` ES TEXTO Y NO UN ENUM NI UNA TABLA
--
-- Un enum obliga a una migración para agregar «Peluquería», que es exactamente la clase de cambio
-- que una clínica quiere hacer sola. Una tabla catálogo sería lo correcto el día que los tipos
-- tengan precio o duración propia; hoy son una etiqueta, y una tabla para eso es una junta más en
-- cada consulta de la agenda.
--
-- El CHECK acota a la lista que ofrece la interfaz. Es lo que impide que una cita quede con un tipo
-- que ninguna pantalla sabe pintar; el día que haya tipos por clínica, se cae este CHECK y se crea
-- la tabla.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'appointments_tipo_conocido'
  ) then
    alter table public.appointments
      add constraint appointments_tipo_conocido check (
        tipo is null or tipo in (
          'consulta_general',
          'consulta_especializada',
          'vacunacion',
          'desparasitacion',
          'cirugia',
          'laboratorio',
          'imagenes',
          'peluqueria',
          'control',
          'urgencia',
          'bloqueo',
          'otro'
        )
      );
  end if;
end
$$;

-- ── La RPC de creación ──────────────────────────────────────────────────────────────────────────
--
-- Se redeclara entera y no se parchea: los tres parámetros nuevos van al final CON DEFAULT, así que
-- todas las llamadas que ya existen —el drawer, el agente, el ejecutor de acciones— siguen andando
-- sin tocarse.
--
-- ── HAY QUE BORRAR LA FIRMA VIEJA, Y ESTO NO ES LIMPIEZA ────────────────────────────────────────
--
-- `create or replace function` reemplaza SÓLO si la firma coincide exacta. Al agregar parámetros se
-- crea una SOBRECARGA: quedan las dos, la de 9 y la de 12. Medido al aplicar esta migración al
-- principal el 26-ago — `pg_proc` devolvía las dos.
--
-- Y no es cosmético: una llamada con los 9 argumentos viejos (el agente de VetGPT, el ejecutor de
-- acciones) encaja en LAS DOS —la nueva tiene defaults para las que faltan— y PostgREST no puede
-- elegir: responde PGRST203, «could not choose the best candidate function». O sea que dejar la
-- vieja rompe justo el camino que esta nota decía proteger.
--
-- El `drop` va ANTES de crear la nueva y con la firma completa y explícita, que es la única forma
-- de nombrar una sobrecarga. `if exists` para que la migración se pueda correr dos veces.
drop function if exists public.create_appointment(
  text, timestamptz, timestamptz, uuid, uuid, uuid, text, public.appointment_status, text
);
drop function if exists public.update_appointment(
  uuid, text, timestamptz, timestamptz, uuid, uuid, uuid, text, public.appointment_status, text
);

create or replace function public.create_appointment(
  p_title      text,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_patient_id uuid default null,
  p_owner_id   uuid default null,
  p_vet_id     uuid default null,
  p_reason     text default null,
  p_status     public.appointment_status default 'scheduled',
  p_notes      text default null,
  p_es_bloqueo boolean default false,
  p_tipo       text default null,
  p_sin_hora   boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_id uuid;
  v_clinic_id uuid := private.my_clinic_id();
begin
  if v_clinic_id is null then
    raise exception 'No clinic assigned to current user';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'La cita debe terminar después de su inicio';
  end if;

  -- ── LO OBLIGATORIO, QUE AHORA DEPENDE DE QUÉ SE ESTÁ CREANDO ─────────────────────────────────
  --
  -- Un BLOQUEO no tiene paciente ni titular —esa es su definición— pero sigue necesitando un
  -- MOTIVO: un espacio reservado sin decir para qué es un hueco que nadie sabe si puede usar.
  if p_es_bloqueo then
    if p_patient_id is not null or p_owner_id is not null then
      raise exception 'Un bloqueo no lleva paciente ni titular. Si es una cita, desmarca "sólo reservar el espacio".';
    end if;
  else
    if p_patient_id is null then
      raise exception 'El paciente es obligatorio';
    end if;
    if p_owner_id is null then
      raise exception 'El titular es obligatorio';
    end if;
  end if;

  -- El veterinario y el motivo se exigen SIEMPRE, bloqueo o no. Sin veterinario, un bloqueo no
  -- bloquea nada: el antisolape de la 0067 se saltea las citas sin `vet_id`, así que un bloqueo sin
  -- dueño sería un cartel decorativo que no impide agendar encima.
  if p_vet_id is null then
    raise exception 'El veterinario es obligatorio';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'El motivo es obligatorio';
  end if;

  if p_owner_id is not null and not exists (
    select 1 from public.owners where id = p_owner_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Owner does not belong to your clinic';
  end if;

  if p_patient_id is not null and not exists (
    select 1 from public.patients
    where id = p_patient_id and clinic_id = v_clinic_id and owner_id = p_owner_id
  ) then
    raise exception 'El paciente no pertenece al titular indicado';
  end if;

  if not exists (
    select 1 from public.profiles where id = p_vet_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Vet does not belong to your clinic';
  end if;

  insert into public.appointments (
    clinic_id, patient_id, owner_id, vet_id, title, reason, status,
    starts_at, ends_at, notes, created_by, es_bloqueo, tipo, sin_hora
  )
  values (
    v_clinic_id, p_patient_id, p_owner_id, p_vet_id, p_title, nullif(p_reason, ''), p_status,
    p_starts_at, p_ends_at, nullif(p_notes, ''), auth.uid(),
    coalesce(p_es_bloqueo, false), nullif(p_tipo, ''), coalesce(p_sin_hora, false)
  )
  returning id into new_id;

  return new_id;
end;
$function$;

-- ── La RPC de edición ───────────────────────────────────────────────────────────────────────────
--
-- Mismo trato. `update_appointment` reemplaza TODOS los campos (así estaba escrita), así que los
-- tres nuevos van igual: si no viajaran, editarle el título a un bloqueo lo convertiría en una cita
-- normal sin paciente — y la validación de arriba la rechazaría con un error que nadie entendería.

create or replace function public.update_appointment(
  p_id         uuid,
  p_title      text,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_patient_id uuid default null,
  p_owner_id   uuid default null,
  p_vet_id     uuid default null,
  p_reason     text default null,
  p_status     public.appointment_status default 'scheduled',
  p_notes      text default null,
  p_es_bloqueo boolean default false,
  p_tipo       text default null,
  p_sin_hora   boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clinic_id uuid := private.my_clinic_id();
begin
  if v_clinic_id is null then
    raise exception 'No clinic assigned to current user';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'La cita debe terminar después de su inicio';
  end if;

  if p_es_bloqueo then
    if p_patient_id is not null or p_owner_id is not null then
      raise exception 'Un bloqueo no lleva paciente ni titular. Si es una cita, desmarca "sólo reservar el espacio".';
    end if;
  else
    if p_patient_id is null then
      raise exception 'El paciente es obligatorio';
    end if;
    if p_owner_id is null then
      raise exception 'El titular es obligatorio';
    end if;
  end if;

  if p_vet_id is null then
    raise exception 'El veterinario es obligatorio';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'El motivo es obligatorio';
  end if;

  if p_owner_id is not null and not exists (
    select 1 from public.owners where id = p_owner_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Owner does not belong to your clinic';
  end if;

  if p_patient_id is not null and not exists (
    select 1 from public.patients
    where id = p_patient_id and clinic_id = v_clinic_id and owner_id = p_owner_id
  ) then
    raise exception 'El paciente no pertenece al titular indicado';
  end if;

  if not exists (
    select 1 from public.profiles where id = p_vet_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Vet does not belong to your clinic';
  end if;

  update public.appointments
     set title      = p_title,
         starts_at  = p_starts_at,
         ends_at    = p_ends_at,
         patient_id = p_patient_id,
         owner_id   = p_owner_id,
         vet_id     = p_vet_id,
         reason     = nullif(p_reason, ''),
         status     = p_status,
         notes      = nullif(p_notes, ''),
         es_bloqueo = coalesce(p_es_bloqueo, false),
         tipo       = nullif(p_tipo, ''),
         sin_hora   = coalesce(p_sin_hora, false),
         updated_at = now()
   -- `clinic_id` explícito: `security definer` deja la RLS de lado, y sin esto se podría editar la
   -- cita de otra clínica sabiendo su id.
   where id = p_id and clinic_id = v_clinic_id;

  if not found then
    raise exception 'Esa cita no es de tu clínica.';
  end if;

  return p_id;
end;
$function$;

-- ── LOS PERMISOS ────────────────────────────────────────────────────────────────────────────────
--
-- `revoke ... from public` NO alcanza, y esto se vio al aplicar la migración al principal el
-- 26-ago: la función quedó con `anon=X`. Es que Supabase tiene `alter default privileges` que le
-- concede EXECUTE a `anon` sobre toda función nueva de `public`, y esa concesión es EXPLÍCITA para
-- el rol — quitarle el permiso a `public` no la toca.
--
-- No era explotable (sin sesión, `private.my_clinic_id()` devuelve null y la función corta con «No
-- clinic assigned»), pero dejaba a estas dos RPC de ESCRITURA como las únicas del sistema
-- alcanzables sin sesión: las otras cuatro —`create_invitation`, `remove_clinic_member`,
-- `cambiar_rol_de_miembro`, `otorgar_agenda_completa`— no tienen `anon`. Se revoca explícito para
-- que la superficie sea la misma en todas.
revoke all on function public.create_appointment(text, timestamptz, timestamptz, uuid, uuid, uuid, text, public.appointment_status, text, boolean, text, boolean) from public;
revoke execute on function public.create_appointment(text, timestamptz, timestamptz, uuid, uuid, uuid, text, public.appointment_status, text, boolean, text, boolean) from anon;
grant execute on function public.create_appointment(text, timestamptz, timestamptz, uuid, uuid, uuid, text, public.appointment_status, text, boolean, text, boolean) to authenticated;
revoke all on function public.update_appointment(uuid, text, timestamptz, timestamptz, uuid, uuid, uuid, text, public.appointment_status, text, boolean, text, boolean) from public;
revoke execute on function public.update_appointment(uuid, text, timestamptz, timestamptz, uuid, uuid, uuid, text, public.appointment_status, text, boolean, text, boolean) from anon;
grant execute on function public.update_appointment(uuid, text, timestamptz, timestamptz, uuid, uuid, uuid, text, public.appointment_status, text, boolean, text, boolean) to authenticated;
