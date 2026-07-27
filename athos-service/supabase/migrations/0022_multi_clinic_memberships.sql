-- Modelo multi-clinica: profiles.clinic_id/role pasan a ser el puntero de "clinica activa"
-- (lo que ya leen las ~34 RLS policies via private.my_clinic_id()/my_role() y ~20 call sites
-- del front) y public.memberships pasa a ser la fuente de verdad de "a que clinicas pertenece
-- este usuario, con que rol". Tambien mueve el aprovisionamiento de clinica del app-level
-- best-effort (ensureClinicForUser, con try/catch que "no debe bloquear el login") a un
-- trigger de BD sobre auth.users, que es inmune a fallos de red/PKCE en el navegador y cubre
-- por igual magic link, Google OAuth e invite links de GoTrue (todos flipean
-- auth.users.email_confirmed_at desde dentro de GoTrue, sin pasar por rutas Next.js).
--
-- public.memberships (clinic_id, user_id, role clinic_role, unique(clinic_id,user_id)) ya
-- existia en la BD viva pero out-of-band: 0 filas, sin FKs, RLS enabled pero sin policies,
-- 0 referencias en codigo o en otras migraciones.

-- =========================================================================
-- 1) Arreglar public.memberships: FKs, RLS, y reusar user_role (admin/vet) en vez del
--    enum redundante clinic_role (owner/vet), que no se usaba en ningun otro lado.
-- =========================================================================
alter table public.memberships alter column role drop default;
alter table public.memberships
  alter column role type public.user_role
  using (case role::text when 'owner' then 'admin' else role::text end)::public.user_role;
alter table public.memberships alter column role set default 'vet'::public.user_role;
drop type public.clinic_role;

alter table public.memberships
  add constraint memberships_clinic_id_fkey foreign key (clinic_id) references public.clinics(id) on delete cascade,
  add constraint memberships_user_id_fkey   foreign key (user_id)   references public.profiles(id) on delete cascade;

create index if not exists idx_memberships_user on public.memberships(user_id);

create policy "memberships_select_own" on public.memberships
  for select using (user_id = auth.uid());
create policy "memberships_select_clinic_admin" on public.memberships
  for select using (clinic_id = private.my_clinic_id() and private.my_role() = 'admin');
-- Sin insert/update/delete policies: toda escritura pasa por RPCs SECURITY DEFINER
-- (mismo patron que profiles, que tampoco tiene insert policy propia).

-- =========================================================================
-- 2) Helpers de aprovisionamiento compartidos
-- =========================================================================
create or replace function private.provision_new_clinic(p_user_id uuid, p_clinic_name text)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_clinic_id uuid;
begin
  insert into public.clinics (name) values (p_clinic_name) returning id into v_clinic_id;

  update public.profiles set clinic_id = v_clinic_id, role = 'admin' where id = p_user_id;

  insert into public.memberships (clinic_id, user_id, role)
  values (v_clinic_id, p_user_id, 'admin')
  on conflict (clinic_id, user_id) do nothing;

  return v_clinic_id;
end;
$function$;

create or replace function private.ensure_clinic_membership(p_user_id uuid, p_email text, p_raw_meta jsonb)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_clinic_id uuid;
  v_has_invite boolean;
  v_name text;
begin
  select clinic_id into v_clinic_id from public.profiles where id = p_user_id;
  if v_clinic_id is not null then
    return; -- ya activo en una clinica
  end if;

  select exists (
    select 1 from public.invitations
    where lower(email) = lower(p_email) and accepted_at is null and expires_at > now()
  ) into v_has_invite;
  if v_has_invite then
    return; -- invitado pendiente: accept_invitation() lo resuelve
  end if;

  v_name := coalesce(
    nullif(p_raw_meta->>'clinic_name', ''),
    'Clinica de ' || coalesce(p_raw_meta->>'full_name', p_raw_meta->>'name', split_part(p_email, '@', 1))
  );
  perform private.provision_new_clinic(p_user_id, v_name);
end;
$function$;

-- =========================================================================
-- 3) Redefinir funciones existentes (mismas firmas, sin romper llamadas)
-- =========================================================================
create or replace function public.create_clinic(clinic_name text)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
begin
  return private.provision_new_clinic(auth.uid(), clinic_name);
end;
$function$;

create or replace function public.accept_invitation(invite_token text)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  inv public.invitations%rowtype;
begin
  select * into inv from public.invitations
  where token = invite_token and accepted_at is null and expires_at > now();
  if not found then raise exception 'Invitacion invalida o expirada'; end if;

  update public.profiles
    set clinic_id = inv.clinic_id, role = inv.role,
        setup_completed_at = coalesce(setup_completed_at, now())
    where id = auth.uid();

  -- ADD, no reemplaza: conserva memberships previas, solo agrega/actualiza esta.
  insert into public.memberships (clinic_id, user_id, role)
  values (inv.clinic_id, auth.uid(), inv.role)
  on conflict (clinic_id, user_id) do update set role = excluded.role;

  update public.invitations set accepted_at = now() where id = inv.id;
end;
$function$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;

  -- Edge case: usuario ya creado con email confirmado en el INSERT (p.ej. desde Studio
  -- con auto-confirm). El caso normal (confirma despues) lo cubre el trigger de UPDATE.
  if new.email_confirmed_at is not null then
    perform private.ensure_clinic_membership(new.id, new.email, new.raw_user_meta_data);
  end if;
  return new;
end;
$function$;

-- =========================================================================
-- 4) Trigger de confirmacion + RPC para cambiar de clinica activa
-- =========================================================================
create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform private.ensure_clinic_membership(new.id, new.email, new.raw_user_meta_data);
  return new;
end;
$function$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute procedure public.handle_user_confirmed();

create or replace function public.switch_active_clinic(target_clinic_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_role public.user_role;
begin
  select role into v_role from public.memberships
    where clinic_id = target_clinic_id and user_id = auth.uid();
  if not found then
    raise exception 'No perteneces a esa clinica';
  end if;
  update public.profiles set clinic_id = target_clinic_id, role = v_role where id = auth.uid();
end;
$function$;

-- =========================================================================
-- 5) Backfill: 2 huerfanos (clinic_id null, nunca iniciaron sesion) -> clinica catch-all
-- =========================================================================
do $$
declare
  v_catchall_id uuid;
begin
  insert into public.clinics (name) values ('Clínica sin asignar') returning id into v_catchall_id;

  update public.profiles set clinic_id = v_catchall_id, role = 'vet' where clinic_id is null;

  insert into public.memberships (clinic_id, user_id, role)
  select v_catchall_id, id, 'vet' from public.profiles where clinic_id = v_catchall_id
  on conflict (clinic_id, user_id) do nothing;
end $$;

-- =========================================================================
-- 6) Backfill completo de memberships (los perfiles pre-existentes 1:1 con su clinica
--    tampoco tenian fila en memberships, no solo los huerfanos)
-- =========================================================================
insert into public.memberships (clinic_id, user_id, role)
select clinic_id, id, role from public.profiles where clinic_id is not null
on conflict (clinic_id, user_id) do nothing;

-- =========================================================================
-- 7) Invariante a nivel BD: un profile no puede quedar sin clinic_id salvo los 2 estados
--    transitorios legitimos (aun no confirma, o invitado pendiente de aceptar). Reemplaza
--    el NOT NULL literal, que rompería esos dos casos.
-- =========================================================================
create or replace function public.enforce_profile_clinic_invariant()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_email text;
  v_confirmed boolean;
  v_has_invite boolean;
begin
  if new.clinic_id is not null then
    return new;
  end if;

  select email, (email_confirmed_at is not null) into v_email, v_confirmed
    from auth.users where id = new.id;

  if not coalesce(v_confirmed, false) then
    return new; -- NULL transitorio legitimo: aun no confirma
  end if;

  select exists (
    select 1 from public.invitations
    where lower(email) = lower(v_email) and accepted_at is null and expires_at > now()
  ) into v_has_invite;
  if v_has_invite then
    return new; -- NULL transitorio legitimo: invitado, esperando accept_invitation()
  end if;

  raise exception 'profiles.clinic_id no puede ser NULL: usuario % confirmado, sin invitacion pendiente', new.id;
end;
$function$;

drop trigger if exists profiles_clinic_invariant on public.profiles;
create trigger profiles_clinic_invariant
  before insert or update of clinic_id on public.profiles
  for each row execute procedure public.enforce_profile_clinic_invariant();
