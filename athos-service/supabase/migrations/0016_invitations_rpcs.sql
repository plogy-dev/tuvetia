-- ============================================================
-- 0016_invitations_rpcs.sql
-- Equipo de la clínica — RPCs sobre la infraestructura de invitaciones YA existente
-- (tabla public.invitations + accept_invitation(token), del esquema base; policies solo-admin).
--
--   1. create_invitation(email, role): genera el token server-side y crea/renueva la invitación.
--      Solo admins de la clínica (igual que las policies de la tabla).
--   2. has_pending_invitation(): ¿el usuario actual (por su email) tiene invitación vigente?
--      La usa el alta (ensureClinicForUser) para NO crear una clínica huérfana al invitado.
-- ============================================================

create or replace function public.create_invitation(
  p_email text,
  p_role  public.user_role default 'vet'
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clinic_id uuid := private.my_clinic_id();
  v_token text;
begin
  if v_clinic_id is null then
    raise exception 'No clinic assigned to current user';
  end if;
  if private.my_role() is distinct from 'admin'::public.user_role then
    raise exception 'Solo un administrador puede invitar miembros';
  end if;
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email inválido';
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  -- Si ya hay una invitación pendiente para ese email en la clínica, se renueva (token y expiración).
  update public.invitations
     set token = v_token,
         role = p_role,
         invited_by = auth.uid(),
         expires_at = now() + interval '7 days'
   where clinic_id = v_clinic_id
     and lower(email) = lower(p_email)
     and accepted_at is null;

  if not found then
    insert into public.invitations (clinic_id, email, role, invited_by, token, expires_at)
    values (v_clinic_id, lower(p_email), p_role, auth.uid(), v_token, now() + interval '7 days');
  end if;

  return v_token;
end;
$function$;


create or replace function public.has_pending_invitation()
returns boolean
language sql
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.invitations
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and accepted_at is null
      and expires_at > now()
  );
$function$;
