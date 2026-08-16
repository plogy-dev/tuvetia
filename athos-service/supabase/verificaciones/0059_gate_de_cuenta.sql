-- Verificación del gate de cuenta desactivada (migración 0059).
--
-- CÓMO SE CORRE, después de aplicar la 0059 a dev:
--
--     psql "$DATABASE_URL_DEV" -v ON_ERROR_STOP=1 -f supabase/verificaciones/0059_gate_de_cuenta.sql
--
-- Termina en ROLLBACK: no deja una fila. Se puede correr las veces que haga falta, y es seguro
-- contra cualquier base — aunque el runbook manda correrlo contra DEV.
--
-- POR QUÉ ESTO Y NO UN TEST DE PYTEST. Los tests de `tests/test_cross_tenant.py` corren con
-- `service_role`, que SE SALTA LA RLS: por diseño no pueden ver este gate, porque el gate ES la
-- RLS. Verificarlo exige hablarle a Postgres como un usuario `authenticated` con un `auth.uid()`
-- puesto, que es lo que hace este script con `set local request.jwt.claims`.
--
-- QUÉ COMPRUEBA, y las tres son la razón de existir de la 0059:
--   1. Un perfil ACTIVO ve su clínica y sus pacientes. (Que el gate no rompa lo que funciona.)
--   2. Un perfil INACTIVO no ve NI UN paciente de su propia clínica.
--   3. Un perfil INACTIVO sí puede leer su propia fila de `profiles` — que es lo que permite
--      decirle «tu cuenta está desactivada» en vez de «no tienes clínica».
--   4. Aislamiento entre clínicas: el gate no abrió una puerta lateral hacia la clínica ajena.

begin;

do $$
declare
  v_clinica_a uuid := gen_random_uuid();
  v_clinica_b uuid := gen_random_uuid();
  v_usuario   uuid := gen_random_uuid();
  v_ajeno     uuid := gen_random_uuid();
  v_titular   uuid;
  v_visto     int;
  v_clinica   uuid;
begin
  -- ── Semilla ───────────────────────────────────────────────────────────────────────────────────
  insert into public.clinics (id, name) values
    (v_clinica_a, 'Verificación A'), (v_clinica_b, 'Verificación B');

  -- `profiles.id` referencia a `auth.users`, así que se siembra ahí primero.
  --
  -- Y NO se hace `insert into profiles`: el trigger `on_auth_user_created` (handle_new_user) YA
  -- crea la fila del perfil al insertar en `auth.users`. Insertarla a mano choca con
  -- `profiles_pkey` — medido, es exactamente el error que da. Se ACTUALIZA lo que el trigger dejó.
  insert into auth.users (id) values (v_usuario), (v_ajeno);

  update public.profiles set clinic_id = v_clinica_a, full_name = 'Vet de prueba',
         role = 'admin', is_active = true
   where id = v_usuario;
  update public.profiles set clinic_id = v_clinica_b, full_name = 'Vet ajeno',
         role = 'admin', is_active = true
   where id = v_ajeno;

  insert into public.owners (id, clinic_id, full_name)
  values (gen_random_uuid(), v_clinica_a, 'Titular de prueba')
  returning id into v_titular;

  insert into public.patients (clinic_id, owner_id, name, species)
  values (v_clinica_a, v_titular, 'Paciente de prueba', 'canino');

  -- ── 1. Perfil ACTIVO: ve lo suyo ──────────────────────────────────────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_usuario)::text, true);

  select private.my_clinic_id() into v_clinica;
  if v_clinica is distinct from v_clinica_a then
    raise exception 'FALLA 1: un perfil activo debería ver su clínica, y my_clinic_id() devolvió %', v_clinica;
  end if;

  select count(*) into v_visto from public.patients;
  if v_visto <> 1 then
    raise exception 'FALLA 1: un perfil activo debería ver su paciente; vio %', v_visto;
  end if;

  -- ── 2. Perfil INACTIVO: no ve nada de su clínica ──────────────────────────────────────────────
  reset role;
  update public.profiles set is_active = false where id = v_usuario;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_usuario)::text, true);

  select private.my_clinic_id() into v_clinica;
  if v_clinica is not null then
    raise exception 'FALLA 2: EL GATE NO FUNCIONA — my_clinic_id() devolvió % para un perfil inactivo', v_clinica;
  end if;

  select count(*) into v_visto from public.patients;
  if v_visto <> 0 then
    raise exception 'FALLA 2: EL GATE NO FUNCIONA — un perfil inactivo vio % pacientes', v_visto;
  end if;

  if private.my_role() is not null then
    raise exception 'FALLA 2: my_role() debería ser null para un perfil inactivo';
  end if;

  -- ── 3. …pero sí puede leerse a sí mismo ───────────────────────────────────────────────────────
  -- Sin esto la app no puede distinguir «desactivada» de «sin clínica», y le diría al veterinario
  -- que no tiene clínica — que se lee como que sus datos se perdieron.
  select count(*) into v_visto from public.profiles where id = v_usuario;
  if v_visto <> 1 then
    raise exception 'FALLA 3: un perfil inactivo tiene que poder leer su PROPIA fila; leyó %', v_visto;
  end if;

  -- ── 4. Aislamiento entre clínicas, con el gate puesto ─────────────────────────────────────────
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ajeno)::text, true);

  select count(*) into v_visto from public.patients;
  if v_visto <> 0 then
    raise exception 'FALLA 4: la clínica B vio % pacientes de la clínica A', v_visto;
  end if;

  reset role;
  raise notice 'OK — el gate de cuenta desactivada funciona y el aislamiento por clínica se mantiene.';
end $$;

rollback;
