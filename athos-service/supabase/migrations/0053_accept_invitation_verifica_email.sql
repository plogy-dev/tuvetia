-- La invitación tiene dueño: `accept_invitation` comprueba a quién fue dirigida.
--
-- EL AGUJERO. La versión de 0022 buscaba la invitación SÓLO por token:
--
--     select * into inv from public.invitations
--     where token = invite_token and accepted_at is null and expires_at > now();
--
-- La función es SECURITY DEFINER y está concedida a `authenticated` (0026), y escribe
-- `profiles.clinic_id`, `profiles.role` y una fila en `memberships`. O sea que cualquier cuenta con
-- sesión que consiguiera UN token ajeno —un link de invitación reenviado por correo, pegado en un
-- grupo, o el de un ex-empleado— entraba a esa clínica con el rol de la invitación, que
-- `create_invitation` permite que sea `admin`. Desde ahí toda la RLS del producto cuelga de
-- `private.my_clinic_id()`: pacientes, historias clínicas, transcripciones, WhatsApp y facturación.
--
-- El chequeo nominal existía, pero vivía ÚNICAMENTE en la UI (`src/app/invitar/[token]/page.tsx`),
-- y la RPC se puede llamar desde la consola del navegador con la anon key — es literalmente el mismo
-- llamado que hace el botón.
--
-- Verificado contra el proyecto principal antes de escribir esto: el `prosrc` desplegado no menciona
-- el JWT ni el email, y había 3 invitaciones vigentes.
--
-- EL ARREGLO es una condición más, con la forma que las otras dos funciones de invitaciones ya
-- usaban: `has_pending_invitation()` (0016:65) compara `lower(email) = lower(auth.jwt() ->> 'email')`
-- y `create_invitation` guarda el email en minúscula. `accept_invitation` era la única de las tres
-- que no lo hacía.
--
-- El `coalesce(..., '')` importa: sin él, un JWT sin claim de email daría `lower(email) = NULL`, que
-- no es falso sino NULL. En un WHERE se comporta igual, pero dejarlo explícito evita que el día que
-- esta condición se mueva a un OR o a un NOT cambie de significado en silencio.
--
-- El mensaje de error se mantiene igual —genérico— a propósito: distinguir "no es tuya" de "no
-- existe" convertiría la RPC en un oráculo para descubrir qué tokens son válidos.
create or replace function public.accept_invitation(invite_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inv public.invitations%rowtype;
begin
  select * into inv from public.invitations
  where token = invite_token
    and accepted_at is null
    and expires_at > now()
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
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

-- ── Después de aplicarla, correr esto a mano ────────────────────────────────────────────────────
-- Busca invitaciones que YA se aceptaron desde un correo distinto del invitado. Si devuelve algo,
-- esa cuenta está dentro de una clínica que no le corresponde y hay que sacarla (borrar su fila de
-- `memberships` y revisar su `profiles.clinic_id`).
--
--   select i.clinic_id, i.email as invitado, u.email as acepto, i.accepted_at
--   from public.invitations i
--   join public.memberships m on m.clinic_id = i.clinic_id
--   join auth.users u on u.id = m.user_id
--   where i.accepted_at is not null
--     and lower(u.email) <> lower(i.email);
--
-- Y para comprobar que la migración quedó aplicada:
--
--   select prosrc ilike '%auth.jwt%' as verifica_email
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'accept_invitation';
--   -- tiene que devolver true
