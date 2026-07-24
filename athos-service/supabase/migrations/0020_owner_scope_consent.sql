-- ============================================================
-- 0020_owner_scope_consent.sql
-- Consentimiento por TITULAR (promesa pública: "un consentimiento cubre todas las mascotas del
-- titular"), SIN debilitar la garantía dura: el trigger de Ley 1581 sigue exigiendo una fila en
-- `consents` por consulta. Lo que cambia es la UX: si el titular ya dio un consentimiento vigente
-- (owner_scope=true, no revocado), el grabador NO re-pregunta y auto-inserta la fila de la consulta.
--
--   - consents.owner_scope: true = consentimiento "madre" del titular (cubre futuras consultas).
--   - consents.revoked_at: revocatoria (el titular puede retirarlo en cualquier momento).
--   - has_owner_consent(p_owner_id): ¿hay consentimiento vigente del titular? (lo usa el grabador)
--   - revoke_owner_consent(p_owner_id): revoca los consentimientos madre del titular.
-- ============================================================

alter table public.consents add column if not exists owner_scope boolean not null default false;
alter table public.consents add column if not exists revoked_at timestamptz;

create or replace function public.has_owner_consent(p_owner_id uuid)
returns boolean
language sql
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.consents c
    join public.patients p on p.id = c.patient_id
    where p.owner_id = p_owner_id
      and c.clinic_id = private.my_clinic_id()
      and c.owner_scope
      and c.revoked_at is null
  );
$function$;

create or replace function public.revoke_owner_consent(p_owner_id uuid)
returns void
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
  update public.consents c
     set revoked_at = now()
    from public.patients p
   where p.id = c.patient_id
     and p.owner_id = p_owner_id
     and c.clinic_id = v_clinic_id
     and c.owner_scope
     and c.revoked_at is null;
end;
$function$;
