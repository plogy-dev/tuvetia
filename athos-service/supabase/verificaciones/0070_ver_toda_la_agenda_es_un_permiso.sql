-- Verificación de la 0070 — ver toda la agenda es un permiso que se otorga.
--
-- ⚠️ LEER ESTO ANTES DE CORRERLO: la guarda que protege el permiso empieza con
--
--     if current_user <> 'postgres' and (…)
--
-- y el editor SQL del principal corre COMO `postgres`. O sea que desde ahí la guarda NO se
-- dispara: un `update profiles set ve_agenda_completa = true` pasa sin chistar y parecería que la
-- protección no existe. Por eso esta verificación CAMBIA DE ROL antes de intentarlo — y por eso
-- mismo vale la pena tenerla escrita: sin cambiar de rol, cualquiera que pruebe a mano concluye lo
-- contrario de lo que pasa en producción.
--
-- LO QUE PROTEGE EL PERMISO, y por qué la guarda no es opcional: la policy `profiles_update` es
-- `using (id = auth.uid())`, o sea que cualquiera puede editar su propio perfil desde el cliente.
-- Sin la guarda, un `supabase.from('profiles').update({ ve_agenda_completa: true })` desde la
-- consola del navegador convertiría el permiso en un casillero de autoservicio.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0070.

do $$
declare
  v_perfil uuid;
  v_antes  boolean;
  v_fallo  text;
begin
  -- ── 1. La columna existe, es `not null` y arranca en false ──────────────────────────────────
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='profiles'
       and column_name='ve_agenda_completa' and is_nullable='NO'
  ) then
    raise exception 'falta profiles.ve_agenda_completa (o admite nulo): la 0070 no esta aplicada';
  end if;

  -- Un permiso que puede ser NULL tiene tres estados y sólo dos significan algo. El default en
  -- `false` es lo que hace que nadie lo tenga por omisión.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='profiles'
       and column_name='ve_agenda_completa' and column_default like '%false%'
  ) then
    raise exception 've_agenda_completa no arranca en false: alguien lo tendria sin que se lo dieran';
  end if;

  -- ── 2. El trigger está puesto ───────────────────────────────────────────────────────────────
  if not exists (
    select 1 from pg_trigger
     where tgname = 'profiles_guard_sensitive_columns' and not tgisinternal
  ) then
    raise exception 'falta el trigger profiles_guard_sensitive_columns';
  end if;

  select id, ve_agenda_completa into v_perfil, v_antes
    from public.profiles order by created_at limit 1;
  if v_perfil is null then
    raise exception 'hace falta al menos un perfil';
  end if;

  -- ── 3. LA GUARDA MUERDE cuando NO se es `postgres` ──────────────────────────────────────────
  --
  -- El cambio de rol es lo que hace real esta comprobación. `set local` lo deja atado a la
  -- transacción, así que el `raise` final lo deshace junto con todo lo demás.
  begin
    set local role authenticated;
    begin
      update public.profiles set ve_agenda_completa = not v_antes where id = v_perfil;
      v_fallo := '(no fallo)';
    exception
      when others then v_fallo := sqlerrm;
    end;
    set local role postgres;
  end;

  if v_fallo = '(no fallo)' then
    raise exception 'un usuario NO postgres pudo cambiar ve_agenda_completa: la guarda no muerde';
  end if;

  -- Puede fallar por la guarda o por la RLS —las dos lo impiden—, pero si falla por otra cosa el
  -- test estaría dando por buena una protección que no se ejercitó.
  if v_fallo not ilike '%ve_agenda_completa%'
     and v_fallo not ilike '%row-level security%'
     and v_fallo not ilike '%permission denied%'
  then
    raise exception 'el update fallo por un motivo inesperado: %', v_fallo;
  end if;

  -- ── 4. Y la RPC existe con la firma que usa el front ────────────────────────────────────────
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='otorgar_agenda_completa' and p.prosecdef
  ) then
    raise exception 'falta la RPC otorgar_agenda_completa, o no es SECURITY DEFINER';
  end if;

  raise exception '=== 0070 OK === columna not null en false, trigger puesto, la guarda muerde fuera de postgres (%) y la RPC existe', left(v_fallo, 60);
end $$;
