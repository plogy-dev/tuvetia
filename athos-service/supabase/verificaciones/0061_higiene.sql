-- Verificación de la migración 0061. Se pega entera en el SQL Editor del principal DESPUÉS de
-- aplicarla. No escribe nada: sólo lee el catálogo.
--
-- Si algo no cuadra, lanza y dice qué. Si todo está bien, termina con "=== 0061 OK ===".

do $$
declare
  sobran   int;
  faltan   int;
  sin_init int;
  detalle  text;
begin
  -- ── 1. No quedan pares duplicados en NINGUNA tabla ──────────────────────────────────────────
  select count(*), coalesce(string_agg(t || ': ' || ix, ' | '), '')
    into sobran, detalle
  from (
    select i.indrelid::regclass::text as t,
           string_agg(c.relname, ' + ' order by c.relname) as ix
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
    group by i.indrelid,
             regexp_replace(pg_get_indexdef(i.indexrelid), '^CREATE (UNIQUE )?INDEX \S+ ON ', '')
    having count(*) > 1
  ) dup;

  if sobran > 0 then
    raise exception 'Siguen habiendo % pares de indices duplicados: %', sobran, detalle;
  end if;

  -- ── 2. Los que SÍ tenían que quedarse, siguen ahí ───────────────────────────────────────────
  -- Borrar el de un par es correcto; borrar los dos dejaría sin índice una consulta caliente.
  select count(*) into faltan
  from unnest(array[
    'idx_clinical_notes_cons',
    'idx_consultations_patient',
    'idx_transcripts_cons',
    'idx_memberships_user',
    'invitations_token_key'
  ]) as esperado
  where not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = esperado and c.relkind = 'i'
  );

  if faltan > 0 then
    raise exception 'Faltan % indices que TENIAN que quedarse — se borro el del par equivocado', faltan;
  end if;

  -- ── 3. La constraint UNIQUE de invitations.token sigue viva ─────────────────────────────────
  -- Es lo que impide dos invitaciones con el mismo token. Si se hubiera borrado el índice
  -- equivocado, se habría ido con ella.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invitations'::regclass and contype = 'u'
  ) then
    raise exception 'Se perdio la constraint UNIQUE de invitations.token';
  end if;

  -- ── 4. Ninguna policy reevalua auth.uid() por fila ──────────────────────────────────────────
  select count(*), coalesce(string_agg(tablename || '.' || policyname, ' | '), '')
    into sin_init, detalle
  from pg_policies
  where schemaname = 'public'
    and (
      (qual is not null and qual ~ 'auth\.uid\(\)' and qual !~ '\(\s*SELECT\s+auth\.uid')
      or (with_check is not null and with_check ~ 'auth\.uid\(\)' and with_check !~ '\(\s*SELECT\s+auth\.uid')
    );

  if sin_init > 0 then
    raise exception 'Todavia hay % policies con auth.uid() suelto: %', sin_init, detalle;
  end if;

  -- ── 5. Las tres policies siguen dejando pasar lo mismo ──────────────────────────────────────
  -- Envolver en subselect no puede haber cambiado la CONDICION, sólo cuántas veces se evalúa.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select'
      and qual ~ 'id = \( SELECT auth\.uid' and qual ~ 'my_clinic_id'
  ) then
    raise exception 'profiles_select perdio una de sus dos ramas';
  end if;

  raise exception '=== 0061 OK === indices duplicados: 0 | policies con auth.uid() suelto: 0';
end $$;
