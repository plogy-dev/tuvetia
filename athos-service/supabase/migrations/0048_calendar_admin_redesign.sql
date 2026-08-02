-- ============================================================
-- 0048_calendar_admin_redesign.sql
-- Rediseño del calendario: UNA cuenta de Google/Outlook por clínica (la del administrador que la
-- creó), no una por vet. Cierra el pendiente de CALENDARIO.md ("Sync por-vet ... vs. calendario
-- compartido de clínica — a decidir") y el incidente 2026-07-31 donde el pull traía el calendario
-- personal ("primary") de quien estuviera logueado.
--
-- 1) clinics.owner_id — quién es "el administrador" de forma explícita (hoy podía haber varios
--    profiles con role='admin'; owner_id fija cuál es la cuenta que manda para el calendario).
-- 2) create_appointment/update_appointment — paciente/titular/vet/motivo pasan a obligatorios, y
--    se valida que el paciente sea DEL titular indicado (no solo de la clínica).
-- 3) RLS de calendar_integrations — SELECT pasa de "solo mi fila" a "cualquiera de mi clínica",
--    para que un no-admin pueda ver si el admin conectó el calendario.
-- 4) Limpieza: las conexiones de vets que NO son el admin quedan huérfanas del nuevo esquema
--    (push/pull ya no las va a usar) — se borran explícitamente en vez de dejarlas inertes.
-- ============================================================

-- =========================================================================
-- 1) clinics.owner_id
-- =========================================================================
alter table public.clinics
  add column if not exists owner_id uuid references public.profiles(id) on delete set null;

-- Backfill: el admin más antiguo (por profiles.created_at) de cada clínica. Si una clínica no
-- tiene ningún profile con role='admin' (no debería pasar, ver invariante de 0022/0040), cae al
-- profile más antiguo de esa clínica sea cual sea su rol.
update public.clinics c
set owner_id = coalesce(
  (
    select p.id from public.profiles p
    where p.clinic_id = c.id and p.role = 'admin'::public.user_role
    order by p.created_at asc
    limit 1
  ),
  (
    select p.id from public.profiles p
    where p.clinic_id = c.id
    order by p.created_at asc
    limit 1
  )
)
where c.owner_id is null;

create or replace function private.provision_new_clinic(p_user_id uuid, p_clinic_name text)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_clinic_id uuid;
begin
  insert into public.clinics (name, owner_id) values (p_clinic_name, p_user_id) returning id into v_clinic_id;

  update public.profiles set clinic_id = v_clinic_id, role = 'admin' where id = p_user_id;

  insert into public.memberships (clinic_id, user_id, role)
  values (v_clinic_id, p_user_id, 'admin')
  on conflict (clinic_id, user_id) do nothing;

  return v_clinic_id;
end;
$function$;

-- =========================================================================
-- 2) create_appointment / update_appointment: paciente, titular, vet y motivo obligatorios;
--    el paciente debe pertenecer AL TITULAR indicado (no solo a la clínica).
-- =========================================================================
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

  if p_patient_id is null then
    raise exception 'El paciente es obligatorio';
  end if;
  if p_owner_id is null then
    raise exception 'El titular es obligatorio';
  end if;
  if p_vet_id is null then
    raise exception 'El veterinario es obligatorio';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'El motivo es obligatorio';
  end if;

  if not exists (
    select 1 from public.owners where id = p_owner_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Owner does not belong to your clinic';
  end if;

  if not exists (
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

  if p_patient_id is null then
    raise exception 'El paciente es obligatorio';
  end if;
  if p_owner_id is null then
    raise exception 'El titular es obligatorio';
  end if;
  if p_vet_id is null then
    raise exception 'El veterinario es obligatorio';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'El motivo es obligatorio';
  end if;

  if not exists (
    select 1 from public.owners where id = p_owner_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Owner does not belong to your clinic';
  end if;

  if not exists (
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

-- =========================================================================
-- 3) RLS calendar_integrations: SELECT por clínica (no solo la fila propia), para que cualquier
--    vet vea si el admin de su clínica conectó Google/Outlook. INSERT/UPDATE/DELETE siguen
--    restringidos a la fila propia (el backend valida aparte que quien conecta sea el admin).
-- =========================================================================
drop policy if exists "calendar_integrations_select" on public.calendar_integrations;
create policy "calendar_integrations_select" on public.calendar_integrations
  for select using (clinic_id = (select private.my_clinic_id()));

-- =========================================================================
-- 4) Limpieza: conexiones de vets que no son el admin de su clínica. A partir de ahora push/pull
--    solo miran la fila de clinics.owner_id; las demás quedarían huérfanas e inertes, así que se
--    borran (decisión explícita, no se dejan como basura).
-- =========================================================================
delete from public.calendar_integrations ci
using public.clinics c
where ci.clinic_id = c.id
  and ci.user_id is distinct from c.owner_id;
