-- ============================================================
-- 0006_appointment_rpcs.sql
-- Calendario interno (v1a) — RPCs de citas.
--
-- La tabla public.appointments YA existe (000_base_schema.sql) con RLS por
-- private.my_clinic_id() y el índice idx_appointments_starts. Esto agrega solo
-- las RPCs de creación/edición, a imagen de create_owner/create_patient:
--   - SECURITY DEFINER + search_path=public
--   - clinic_id resuelto server-side (nunca lo manda el cliente)
--   - validan que patient/owner/vet pertenezcan a la clínica del usuario
--
-- Mover/redimensionar (drag&resize) y cambios de estado rápidos van por UPDATE
-- directo bajo RLS (appointments_update): solo tocan starts_at/ends_at/status,
-- sin cambiar refs, así que no necesitan validación extra.
--
-- Nota de seguridad: igual que las demás create_* del proyecto, el bloqueo de
-- anónimos es el propio `my_clinic_id() is null` (un anon no tiene clínica).
-- ============================================================

create or replace function public.create_appointment(
  p_title      text,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_patient_id uuid default null,
  p_owner_id   uuid default null,
  p_vet_id     uuid default null,
  p_reason     text default null,
  p_status     public.appointment_status default 'scheduled',
  p_notes      text default null
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

  if p_patient_id is not null and not exists (
    select 1 from public.patients where id = p_patient_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Patient does not belong to your clinic';
  end if;

  if p_owner_id is not null and not exists (
    select 1 from public.owners where id = p_owner_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Owner does not belong to your clinic';
  end if;

  if p_vet_id is not null and not exists (
    select 1 from public.profiles where id = p_vet_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Vet does not belong to your clinic';
  end if;

  insert into public.appointments (
    clinic_id, patient_id, owner_id, vet_id, title, reason, status,
    starts_at, ends_at, notes, created_by
  )
  values (
    v_clinic_id, p_patient_id, p_owner_id, p_vet_id, p_title, nullif(p_reason, ''), p_status,
    p_starts_at, p_ends_at, nullif(p_notes, ''), auth.uid()
  )
  returning id into new_id;

  return new_id;
end;
$function$;


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
  p_notes      text default null
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

  if not exists (
    select 1 from public.appointments where id = p_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Appointment does not belong to your clinic';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'La cita debe terminar después de su inicio';
  end if;

  if p_patient_id is not null and not exists (
    select 1 from public.patients where id = p_patient_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Patient does not belong to your clinic';
  end if;

  if p_owner_id is not null and not exists (
    select 1 from public.owners where id = p_owner_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Owner does not belong to your clinic';
  end if;

  if p_vet_id is not null and not exists (
    select 1 from public.profiles where id = p_vet_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Vet does not belong to your clinic';
  end if;

  update public.appointments set
    title      = p_title,
    starts_at  = p_starts_at,
    ends_at    = p_ends_at,
    patient_id = p_patient_id,
    owner_id   = p_owner_id,
    vet_id     = p_vet_id,
    reason     = nullif(p_reason, ''),
    status     = p_status,
    notes      = nullif(p_notes, ''),
    updated_at = now()
  where id = p_id and clinic_id = v_clinic_id;

  return p_id;
end;
$function$;
