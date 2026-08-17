-- Verificación de la 0066 — los índices de las tablas calientes.
--
-- NO COMPRUEBA EL PLAN DE EJECUCIÓN, y es deliberado. Con 18 titulares y 42 notas, PostgreSQL va a
-- seguir eligiendo `Seq Scan` aunque el índice exista: para una tabla que cabe en dos páginas,
-- escanearla es más barato que abrir un índice. Afirmar "usa índice" haría fallar esta verificación
-- por una decisión CORRECTA del planificador.
--
-- Lo que se comprueba es que el índice ESTÉ y tenga las columnas en el orden que las consultas
-- necesitan. El beneficio aparece solo cuando haya datos — que es exactamente para cuándo se está
-- pagando esta deuda.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0066.

do $$
declare
  v_def text;
  v_n   int;
begin
  -- ── 1. Los dos que no existían en absoluto ────────────────────────────────────────────────
  select pg_get_indexdef(i.oid) into v_def
  from pg_class i where i.relname = 'owners_clinic_nombre_idx';
  if v_def is null then
    raise exception 'falta owners_clinic_nombre_idx: owners seguiria sin ningun indice por clinica';
  end if;
  if v_def not like '%clinic_id%full_name%' then
    raise exception 'owners_clinic_nombre_idx no tiene (clinic_id, full_name) en ese orden: %', v_def;
  end if;

  select pg_get_indexdef(i.oid) into v_def
  from pg_class i where i.relname = 'clinical_notes_clinic_status_idx';
  if v_def is null then
    raise exception 'falta clinical_notes_clinic_status_idx: la señal "notas sin aprobar" seguiria escaneando';
  end if;
  if v_def not like '%clinic_id%status%' then
    raise exception 'clinical_notes_clinic_status_idx no tiene (clinic_id, status) en ese orden: %', v_def;
  end if;

  -- ── 2. Las cuatro FK que quedaban sin cubrir ──────────────────────────────────────────────
  select count(*) into v_n
  from pg_class i
  where i.relname in (
    'whatsapp_messages_owner_idx',
    'consultations_owner_idx',
    'consultations_vet_idx',
    'clinical_notes_approved_by_idx'
  );
  if v_n <> 4 then
    raise exception 'se esperaban 4 indices de llaves foraneas y hay %', v_n;
  end if;

  -- ── 3. Que ninguna de las dos tablas siga sin cobertura por clinica ───────────────────────
  -- Es la comprobacion que de verdad importa: no que exista UN indice con cierto nombre, sino que
  -- la tabla tenga alguno que empiece por clinic_id.
  foreach v_def in array array['owners', 'clinical_notes']
  loop
    select count(*) into v_n
    from pg_index x
    join pg_class t on t.oid = x.indrelid
    join pg_attribute a on a.attrelid = t.oid and a.attnum = x.indkey[0]
    where t.relname = v_def and a.attname = 'clinic_id';
    if v_n = 0 then
      raise exception 'la tabla % sigue sin ningun indice que empiece por clinic_id', v_def;
    end if;
  end loop;

  raise exception '=== 0066 OK === owners y clinical_notes con indice por clinica, y 4 FK cubiertas';
end $$;
