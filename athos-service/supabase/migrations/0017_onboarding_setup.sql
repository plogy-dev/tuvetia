-- ============================================================
-- 0017_onboarding_setup.sql
-- Onboarding de vets nuevos — flag del WIZARD de bienvenida (/bienvenida).
--
-- `setup_completed_at` es distinto de `onboarded_at` (0013): onboarded = tour de driver.js;
-- setup = wizard de configuración inicial. Backfill a now() para todos los perfiles existentes
-- (nadie activo cae al wizard). Los INVITADOS tampoco lo ven: accept_invitation lo marca al
-- asignarlos a una clínica ya montada.
-- ============================================================

alter table public.profiles add column if not exists setup_completed_at timestamptz;

update public.profiles set setup_completed_at = now() where setup_completed_at is null;

create or replace function public.mark_setup_completed()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.profiles set setup_completed_at = now()
   where id = (select auth.uid()) and setup_completed_at is null;
end;
$function$;

-- accept_invitation: además de asignar clínica+rol, marca el setup como completado
-- (el invitado entra a una clínica ya configurada — no debe ver el wizard).
create or replace function public.accept_invitation(invite_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inv public.invitations%rowtype;
begin
  select * into inv
  from public.invitations
  where token = invite_token
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'Invitación inválida o expirada';
  end if;

  update public.profiles
  set clinic_id = inv.clinic_id,
      role      = inv.role,
      setup_completed_at = coalesce(setup_completed_at, now())
  where id = auth.uid();

  update public.invitations
  set accepted_at = now()
  where id = inv.id;
end;
$function$;
