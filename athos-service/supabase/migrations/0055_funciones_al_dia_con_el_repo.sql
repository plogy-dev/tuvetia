-- Cuatro funciones cuyo cuerpo EN PRODUCCIÓN no es el del repo.
--
-- CÓMO SE DETECTÓ. Se comparó el `prosrc` normalizado (sin espacios) de las 22 funciones de
-- `public` contra la última definición de cada una en el repo:
--
--   select p.proname, md5(regexp_replace(p.prosrc,'\s+','','g'))
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prokind = 'f';
--
-- 18 coincidían byte a byte. Cuatro no: `create_invitation`, `remove_clinic_member`,
-- `enforce_profile_clinic_invariant` y `handle_new_user`.
--
-- QUÉ CAMBIA ENTRE UNA Y OTRA. La lógica es la misma. Lo que falta en producción son los
-- comentarios y LOS ACENTOS: alguien las transcribió a mano en el SQL Editor en vez de aplicar el
-- archivo. `remove_clinic_member` tiene en producción la MISMA longitud exacta y distinto
-- contenido, que es la prueba más limpia de que se reescribió en vivo.
--
-- Hoy un admin que intenta quitarse a sí mismo del equipo lee:
--     "No podes quitarte a vos mismo del equipo"
--     "No podes quitar al unico administrador de la clinica"
--     "Ese usuario no pertenece a tu clinica"
--
-- POR QUÉ IMPORTA MÁS QUE LAS TILDES. Mientras producción y repo no coincidan, el repo deja de ser
-- la fuente de verdad: cualquiera que lea `0040_team_management.sql` para entender qué hace el
-- sistema está leyendo algo que no es lo que corre. Estas cuatro son SECURITY DEFINER y deciden
-- quién entra a una clínica y quién sale de ella.
--
-- Son `create or replace` de los MISMOS archivos del repo, copiadas literales de
-- `0016_invitations_rpcs.sql`, `0040_team_management.sql` y `0041_oauth_metadata_fallback.sql`.
-- No hay ni un cambio de comportamiento: reaplicar esta migración sobre una base que ya esté al día
-- no cambia absolutamente nada.
--
-- POR QUÉ VA AL FINAL Y NO JUNTO A SUS ORIGINALES. Tres de estas cuatro se definen en la 0040 y la
-- 0041; una corrección numerada antes que ellas quedaría pisada por su propia fuente en cualquier
-- reconstrucción desde cero. Al ir última, gana siempre — y sobre una base recién construida es
-- redundante e inofensiva, que es exactamente lo que se quiere de una corrección.

-- ── de 0016_invitations_rpcs.sql ────────────────────────────────────────────────────────────────
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

-- ── de 0040_team_management.sql ─────────────────────────────────────────────────────────────────
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

-- ── de 0041_oauth_metadata_fallback.sql ─────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do nothing;

  -- Edge case: usuario ya creado con email confirmado en el INSERT (p.ej. desde Studio
  -- con auto-confirm). El caso normal (confirma despues) lo cubre el trigger de UPDATE.
  if new.email_confirmed_at is not null then
    perform private.ensure_clinic_membership(new.id, new.email, new.raw_user_meta_data);
  end if;
  return new;
end;
$function$;

-- ── Comprobación, para correr después de aplicarla ──────────────────────────────────────────────
-- Las cuatro tienen que llevar tilde. Si alguna sigue sin ella, se aplicó desde una copia mal
-- codificada (pegar SQL en un editor que no respeta UTF-8 es cómo se llegó acá la primera vez).
--
--   select proname, prosrc like '%podés%' or prosrc like '%inválido%' or prosrc like '%legítimo%'
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and proname in ('create_invitation','remove_clinic_member',
--                     'enforce_profile_clinic_invariant','handle_new_user');
--   -- las cuatro en true
