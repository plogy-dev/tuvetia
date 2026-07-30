-- ============================================================
-- 0040_team_management.sql
-- Equipo (Settings): exponer el email de los miembros (vive en auth.users, no en
-- public.profiles) y permitir que un admin quite a alguien de la clínica.
-- ============================================================

-- get_clinic_members: variante de "profiles_select" (mismo alcance: solo tu clínica) que además
-- trae el email desde auth.users, tabla que PostgREST no expone directamente al cliente.
create or replace function public.get_clinic_members()
returns table (id uuid, full_name text, email text, role public.user_role)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, p.full_name, u.email, p.role
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.clinic_id = private.my_clinic_id()
  order by p.full_name;
$function$;

-- remove_clinic_member: solo admin, no a sí mismo, no al único admin restante (se quedaría la
-- clínica sin nadie que pueda invitar/quitar). Si el usuario tiene otra clínica activa
-- (memberships), cae ahí; si no, clinic_id queda NULL — nuevo estado legítimo, ver más abajo.
create or replace function public.remove_clinic_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clinic_id uuid := private.my_clinic_id();
  v_target_clinic_id uuid;
  v_target_role public.user_role;
  v_admin_count int;
  v_next_clinic_id uuid;
  v_next_role public.user_role;
begin
  if private.my_role() is distinct from 'admin'::public.user_role then
    raise exception 'Solo un administrador puede quitar miembros del equipo';
  end if;
  if p_member_id = auth.uid() then
    raise exception 'No podés quitarte a vos mismo del equipo';
  end if;

  select clinic_id, role into v_target_clinic_id, v_target_role
    from public.profiles where id = p_member_id;

  if v_target_clinic_id is distinct from v_clinic_id then
    raise exception 'Ese usuario no pertenece a tu clínica';
  end if;

  if v_target_role = 'admin'::public.user_role then
    select count(*) into v_admin_count from public.profiles
      where clinic_id = v_clinic_id and role = 'admin'::public.user_role;
    if v_admin_count <= 1 then
      raise exception 'No podés quitar al único administrador de la clínica';
    end if;
  end if;

  delete from public.memberships where clinic_id = v_clinic_id and user_id = p_member_id;

  select clinic_id, role into v_next_clinic_id, v_next_role
    from public.memberships where user_id = p_member_id limit 1;

  update public.profiles
    set clinic_id = v_next_clinic_id,
        role = coalesce(v_next_role, role)
    where id = p_member_id;
end;
$function$;

-- El invariante de 0022 solo dejaba pasar NULL transitorio para "no confirmado todavía" o
-- "invitado pendiente de aceptar". Quitar a alguien del equipo sin otra clínica a la que caer
-- es un tercer estado legítimo (a diferencia de esos dos, no es transitorio: puede quedarse así).
create or replace function public.enforce_profile_clinic_invariant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text;
  v_confirmed boolean;
  v_has_invite boolean;
  v_has_membership boolean;
begin
  if new.clinic_id is not null then
    return new;
  end if;

  select email, (email_confirmed_at is not null) into v_email, v_confirmed
    from auth.users where id = new.id;

  if not coalesce(v_confirmed, false) then
    return new; -- NULL transitorio legítimo: aún no confirma
  end if;

  select exists (
    select 1 from public.invitations
    where lower(email) = lower(v_email) and accepted_at is null and expires_at > now()
  ) into v_has_invite;
  if v_has_invite then
    return new; -- NULL transitorio legítimo: invitado, esperando accept_invitation()
  end if;

  select exists (
    select 1 from public.memberships where user_id = new.id
  ) into v_has_membership;
  if not v_has_membership then
    return new; -- NULL legítimo (no transitorio): removido del equipo, sin otra clínica
  end if;

  raise exception 'profiles.clinic_id no puede ser NULL: usuario % confirmado, sin invitación pendiente', new.id;
end;
$function$;

revoke execute on function public.get_clinic_members() from public, anon;
grant execute on function public.get_clinic_members() to authenticated, service_role;

revoke execute on function public.remove_clinic_member(uuid) from public, anon;
grant execute on function public.remove_clinic_member(uuid) to authenticated, service_role;
