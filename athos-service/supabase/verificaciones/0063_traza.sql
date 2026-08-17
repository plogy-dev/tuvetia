-- Verificación de la 0063 — la traza de lo que hacen las personas.
--
-- NO SÓLO COMPRUEBA QUE LOS OBJETOS EXISTAN: ejercita el trigger de punta a punta con un titular y un
-- paciente de mentira, y revisa que la fila de `audit_logs` diga lo correcto. Un trigger que existe
-- pero no registra es exactamente el fallo que esta migración vino a cerrar, y comprobar sólo su
-- existencia lo dejaría pasar.
--
-- TODO SE DESHACE. El `raise exception` final aborta el bloque, así que el titular y el paciente de
-- prueba no quedan en la base. Es la misma técnica que usan las verificaciones anteriores.
--
-- Se corre en el editor SQL del proyecto, después de aplicar la 0063.

do $$
declare
  v_clinic  uuid;
  v_owner   uuid;
  v_patient uuid;
  v_fila    public.audit_logs%rowtype;
  v_n       int;
begin
  -- ── 1. La función existe, es SECURITY DEFINER y tiene el search_path fijado ──────────────────
  select count(*) into v_n
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'registrar_cambio'
    and p.prosecdef                                    -- security definer
    and array_to_string(p.proconfig, ',') like '%search_path%';
  if v_n <> 1 then
    raise exception 'private.registrar_cambio() no existe, o no es SECURITY DEFINER con search_path fijo';
  end if;

  -- ── 2. Los cuatro triggers, cada uno en UPDATE y DELETE ─────────────────────────────────────
  select count(*) into v_n
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal
    and t.tgname in ('patients_traza','owners_traza','consultations_traza','appointments_traza')
    and c.relname in ('patients','owners','consultations','appointments');
  if v_n <> 4 then
    raise exception 'faltan triggers de traza: se esperaban 4 y hay %', v_n;
  end if;

  -- ── 3. El índice que hace barata la pregunta "la historia de esta ficha" ────────────────────
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'audit_logs' and indexname = 'idx_audit_record'
  ) then
    raise exception 'falta idx_audit_record: consultar la historia de una ficha seria un escaneo completo';
  end if;

  -- ── 4. EL TRIGGER REGISTRA DE VERDAD ────────────────────────────────────────────────────────
  select id into v_clinic from public.clinics order by created_at limit 1;
  if v_clinic is null then
    raise exception 'no hay ninguna clinica: no se puede ejercitar el trigger';
  end if;

  insert into public.owners (clinic_id, full_name)
  values (v_clinic, 'ZZZ verificacion 0063')
  returning id into v_owner;

  insert into public.patients (clinic_id, owner_id, name, species, weight_kg)
  values (v_clinic, v_owner, 'ZZZ verificacion', 'Perro', 10)
  returning id into v_patient;

  -- 4a. Una creación NO se registra: la fila existe y eso ya lo dice.
  select count(*) into v_n from public.audit_logs where record_id in (v_owner, v_patient);
  if v_n <> 0 then
    raise exception 'una creacion no deberia registrarse, y se registraron % filas', v_n;
  end if;

  -- 4b. Una edición sí, y con el campo que cambió.
  update public.patients set weight_kg = 12 where id = v_patient;

  select * into v_fila from public.audit_logs where record_id = v_patient and action = 'patients.updated';
  if v_fila.id is null then
    raise exception 'una edicion de paciente NO quedo registrada';
  end if;
  if v_fila.clinic_id is distinct from v_clinic then
    raise exception 'la traza quedo con la clinica equivocada: % en vez de %', v_fila.clinic_id, v_clinic;
  end if;
  -- Se compara como NÚMERO y no como texto: `weight_kg` es numeric(5,2), así que `to_jsonb` lo
  -- serializa "10.00" y un `<> '10'` fallaría por el formato, no por el dato.
  if (v_fila.payload -> 'cambios' -> 'weight_kg' ->> 'antes')::numeric <> 10
     or (v_fila.payload -> 'cambios' -> 'weight_kg' ->> 'despues')::numeric <> 12 then
    raise exception 'la traza no guardo el antes/despues del peso: %', v_fila.payload;
  end if;
  -- Sólo el campo que cambió: `updated_at` cambia siempre y no debe aparecer.
  -- `jsonb_exists(...)` y no el operador `?`: hay clientes que interpretan el signo de pregunta como
  -- un marcador de parámetro y mutilan la consulta antes de que llegue a Postgres.
  if jsonb_exists(v_fila.payload -> 'cambios', 'updated_at') then
    raise exception 'updated_at no deberia aparecer en los cambios: llenaria la traza de ruido';
  end if;
  if (select count(*) from jsonb_object_keys(v_fila.payload -> 'cambios')) <> 1 then
    raise exception 'se registraron campos que no cambiaron: %', v_fila.payload -> 'cambios';
  end if;

  -- 4c. Un UPDATE que no cambia nada observable no ensucia la traza.
  update public.patients set weight_kg = 12 where id = v_patient;
  select count(*) into v_n from public.audit_logs where record_id = v_patient and action = 'patients.updated';
  if v_n <> 1 then
    raise exception 'un UPDATE sin cambios reales genero traza: hay % filas y deberia haber 1', v_n;
  end if;

  -- 4d. Un borrado guarda la fila entera, que es lo único que va a quedar de ella.
  delete from public.patients where id = v_patient;
  select * into v_fila from public.audit_logs where record_id = v_patient and action = 'patients.deleted';
  if v_fila.id is null then
    raise exception 'un borrado de paciente NO quedo registrado';
  end if;
  if v_fila.payload -> 'fila' ->> 'name' <> 'ZZZ verificacion' then
    raise exception 'el borrado no guardo la fila que se llevo: %', v_fila.payload;
  end if;

  -- 4e. El cascade también deja rastro: borrar el titular se lleva sus pacientes, y eso se registra.
  insert into public.patients (clinic_id, owner_id, name, species)
  values (v_clinic, v_owner, 'ZZZ cascada', 'Gato');
  delete from public.owners where id = v_owner;
  select count(*) into v_n
  from public.audit_logs
  where action = 'patients.deleted' and payload -> 'fila' ->> 'name' = 'ZZZ cascada';
  if v_n <> 1 then
    raise exception 'el borrado en cascada NO dejo rastro del paciente arrastrado';
  end if;

  raise exception '=== 0063 OK === funcion, 4 triggers, indice, y registro verificado en edicion, borrado, cascada y no-cambio';
end $$;
