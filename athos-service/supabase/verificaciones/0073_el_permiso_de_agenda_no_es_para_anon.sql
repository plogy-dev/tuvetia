-- Verificación de la 0073 — `otorgar_agenda_completa` deja de estar concedida a `anon`.
--
-- MIRA LA ACL DE VERDAD, no el texto de la migración. Un `revoke` que corrió sobre la firma
-- equivocada —la función está sobrecargada por tipos, y `(uuid, boolean)` es una de varias formas
-- posibles de escribirla— no falla: no hace nada, y deja la ACL igual que antes. Comparar contra
-- `pg_proc.proacl` es lo único que distingue "se aplicó" de "se ejecutó sin error".
--
-- Y COMPRUEBA LAS DOS MITADES. Que `anon` ya no esté es la mitad obvia; que `authenticated` SIGA
-- estando es la que evita cambiar un agujero por una función rota. Sin ese privilegio, un
-- administrador dejaría de poder otorgar el permiso de ver toda la agenda y el síntoma aparecería
-- recién cuando alguien lo intentara.
--
-- La tercera comprobación es contra la casa: esta función tenía que quedar como sus pares. Si
-- mañana aparece otra `SECURITY DEFINER` con `anon`, esto la nombra en vez de dejarla pasar.
--
-- No escribe nada, así que no hay datos de prueba que deshacer; el `raise` final es sólo la señal
-- de éxito que pide el runbook.

do $$
declare
  v_acl        text;
  v_intrusas   text;
begin
  select coalesce(array_to_string(p.proacl, ' | '), '(sin ACL -> PUBLIC implicito)')
    into v_acl
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'otorgar_agenda_completa';

  if v_acl is null then
    raise exception 'no existe public.otorgar_agenda_completa — la 0070 no esta aplicada';
  end if;

  -- ── 1. `anon` ya no puede ejecutarla ─────────────────────────────────────────────────────
  --
  -- Se busca `anon=` y no `anon` a secas: el otorgante aparece despues de la barra en cada
  -- entrada (`anon=X/postgres`), asi que un `like '%anon%'` daria positivo con cualquier ACL
  -- otorgada por un rol que se llame asi.
  if v_acl like '%anon=%' then
    raise exception 'anon SIGUE con execute: la 0073 no se aplico. ACL = %', v_acl;
  end if;

  -- ── 2. Y `authenticated` sigue pudiendo ──────────────────────────────────────────────────
  --
  -- La mitad que evita cambiar un agujero por una funcion rota.
  if v_acl not like '%authenticated=%' then
    raise exception 'authenticated PERDIO execute: ningun admin puede otorgar el permiso. ACL = %', v_acl;
  end if;

  if v_acl not like '%service_role=%' then
    raise exception 'service_role perdio execute. ACL = %', v_acl;
  end if;

  -- ── 3. Ninguna otra SECURITY DEFINER de public quedo abierta a `anon` ────────────────────
  --
  -- El hallazgo original fue que esta era LA UNICA excepcion entre veinte. Fijar esa propiedad
  -- —y no solo el caso puntual— es lo que hace que la proxima aparezca acá y no en el linter
  -- tres semanas despues.
  select string_agg(p.proname, ', ' order by p.proname)
    into v_intrusas
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and array_to_string(p.proacl, ' | ') like '%anon=%';

  if v_intrusas is not null then
    raise exception 'hay SECURITY DEFINER ejecutables por anon: %', v_intrusas;
  end if;

  raise exception '=== 0073 OK === anon sin execute, authenticated y service_role conservados, y ninguna otra SECURITY DEFINER de public abierta a anon. ACL = %', v_acl;
end $$;
