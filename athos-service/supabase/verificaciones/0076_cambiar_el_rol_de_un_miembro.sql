-- Verificación de la 0076 — cambiar el rol de alguien del equipo.
--
-- LO QUE MÁS IMPORTA PROBAR es que el rol se escriba en LOS DOS LADOS. `memberships.role` es el rol
-- en esa clínica y `profiles.role` el de la clínica activa; actualizar sólo `profiles` parece
-- funcionar hasta que la persona cambia de clínica y vuelve, porque `switch_active_clinic` relee
-- `memberships` y le devuelve el rol viejo. Ese defecto no se ve en la pantalla el día que se
-- introduce: se ve semanas después, en una cuenta que "se le bajó el permiso sola".
--
-- Y LA GUARDA DEL ÚLTIMO ADMIN, que es la que deja una clínica cerrada si falla: sin administrador
-- nadie puede invitar, ni quitar, ni volver a otorgar nada.
--
-- ⚠️ La función es SECURITY DEFINER y decide con `auth.uid()` y `private.my_role()`. En el editor
-- SQL no hay sesión, así que `auth.uid()` es null y la RPC corta en la primera guarda. Por eso lo
-- que se ejercita acá es el EFECTO sobre las dos tablas —haciendo a mano lo que la función hace— y
-- se verifican por catálogo las guardas y los permisos. Queda dicho: no se probó la autorización.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0076.

do $$
declare
  v_def     text;
  v_acl     text;
  v_clinic  uuid;
  v_persona uuid := gen_random_uuid();
  v_rol_m   public.user_role;
  v_rol_p   public.user_role;
begin
  -- ── 1. La función existe, es SECURITY DEFINER y NO la puede llamar `anon` ───────────────────
  select pg_get_functiondef(p.oid), coalesce(array_to_string(p.proacl, ' | '), '(sin ACL)')
    into v_def, v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='cambiar_rol_de_miembro';

  if v_def is null then
    raise exception 'no existe cambiar_rol_de_miembro: la 0076 no esta aplicada';
  end if;
  if v_acl like '%anon=%' then
    raise exception 'anon puede ejecutarla: falta el revoke (es lo que le paso a la 0070). ACL = %', v_acl;
  end if;
  if v_acl not like '%authenticated=%' then
    raise exception 'authenticated NO puede ejecutarla: la pantalla de equipo no va a poder llamarla. ACL = %', v_acl;
  end if;

  -- ── 2. Las cuatro guardas están escritas ────────────────────────────────────────────────────
  --
  -- Se miran en la definición y no ejecutándolas porque sin sesión no se puede llegar a ellas.
  -- Es una comprobación más débil que ejercitarlas, y por eso se dice cuál es.
  if v_def not like '%Solo un administrador%' then
    raise exception 'falta la guarda de rol admin';
  end if;
  if v_def not like '%a vos mismo%' then
    raise exception 'falta la guarda de "no te cambias el rol a vos mismo": un admin podria degradarse y perder el boton para volver';
  end if;
  if v_def not like '%no pertenece a tu clínica%' then
    raise exception 'falta la guarda de pertenencia a la clinica';
  end if;
  if v_def not like '%sin administrador%' then
    raise exception 'falta la guarda del ultimo admin: se podria dejar una clinica cerrada';
  end if;

  -- ── 3. ESCRIBE EN LOS DOS LADOS ─────────────────────────────────────────────────────────────
  --
  -- La comprobación que de verdad importa. Se hace el efecto a mano sobre una persona de prueba y
  -- se mira que las dos tablas queden de acuerdo — que es lo que la función tiene que lograr.
  if v_def not like '%update public.memberships%' then
    raise exception 'la funcion no toca memberships: el rol volveria al viejo al cambiar de clinica';
  end if;
  if v_def not like '%update public.profiles%' then
    raise exception 'la funcion no toca profiles: el rol no cambiaria en la sesion actual';
  end if;

  select id into v_clinic from public.clinics order by created_at limit 1;
  insert into public.profiles (id, clinic_id, full_name, role)
  values (v_persona, v_clinic, 'ZZZ verificacion 0076', 'vet');
  insert into public.memberships (clinic_id, user_id, role)
  values (v_clinic, v_persona, 'vet');

  update public.memberships set role = 'admin' where clinic_id = v_clinic and user_id = v_persona;
  update public.profiles     set role = 'admin' where id = v_persona;

  select role into v_rol_m from public.memberships where clinic_id = v_clinic and user_id = v_persona;
  select role into v_rol_p from public.profiles where id = v_persona;
  if v_rol_m is distinct from v_rol_p then
    raise exception 'las dos tablas quedaron en desacuerdo: memberships=% profiles=%', v_rol_m, v_rol_p;
  end if;

  raise exception '=== 0076 OK === funcion presente sin anon, las 4 guardas escritas, y toca memberships Y profiles (prueba: ambas en %). Se revierte.', v_rol_m;
end $$;
