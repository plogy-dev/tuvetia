-- Verificación de la 0064 — borrar un titular deja de poder fallar.
--
-- REPRODUCE EL CASO QUE HOY SE ROMPE, no sólo mira el catálogo: monta la anomalía —una consulta cuyo
-- `owner_id` es un titular pero cuyo `patient_id` pertenece a OTRO— y borra el titular. Antes de la
-- 0064 ese DELETE fallaba con violación de llave foránea; después tiene que pasar, y la consulta
-- tiene que seguir viva con el titular en null.
--
-- Comprobar sólo que la restricción diga "SET NULL" dejaría pasar un cambio aplicado a medias.
--
-- TODO SE DESHACE con el `raise exception` final, incluidas las filas que el trigger de la 0063
-- escriba en `audit_logs` al borrar.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0064.

do $$
declare
  v_clinic  uuid;
  v_vet     uuid;
  v_duenoA  uuid;   -- el que se va a borrar
  v_duenoB  uuid;   -- el dueño real del paciente
  v_paciente uuid;
  v_consulta uuid;
  v_owner_tras_borrado uuid;
  v_regla   text;
  v_n       int;
begin
  -- ── 1. La restricción quedó declarada como SET NULL ─────────────────────────────────────────
  select case c.confdeltype when 'n' then 'SET NULL' when 'c' then 'CASCADE'
                            when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' else c.confdeltype::text end
    into v_regla
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  where c.contype = 'f' and t.relname = 'consultations' and c.conname = 'consultations_owner_id_fkey';

  if v_regla is null then
    raise exception 'no existe consultations_owner_id_fkey';
  end if;
  if v_regla <> 'SET NULL' then
    raise exception 'consultations.owner_id sigue en %, deberia ser SET NULL', v_regla;
  end if;

  -- ── 2. LA ANOMALÍA, MONTADA Y BORRADA DE VERDAD ─────────────────────────────────────────────
  select id into v_clinic from public.clinics order by created_at limit 1;
  select id into v_vet from public.profiles where clinic_id = v_clinic limit 1;
  if v_clinic is null or v_vet is null then
    raise exception 'hace falta una clinica con al menos un perfil para montar el caso';
  end if;

  insert into public.owners (clinic_id, full_name) values (v_clinic, 'ZZZ dueno A 0064') returning id into v_duenoA;
  insert into public.owners (clinic_id, full_name) values (v_clinic, 'ZZZ dueno B 0064') returning id into v_duenoB;

  -- El paciente es de B...
  insert into public.patients (clinic_id, owner_id, name, species)
  values (v_clinic, v_duenoB, 'ZZZ paciente de B', 'Perro')
  returning id into v_paciente;

  -- ...pero la consulta apunta a A. Ésta es la fila que rompía el borrado: nada la arrastra por la
  -- via del paciente, porque su paciente NO es de A.
  insert into public.consultations (clinic_id, patient_id, owner_id, vet_id, status)
  values (v_clinic, v_paciente, v_duenoA, v_vet, 'open')
  returning id into v_consulta;

  -- Antes de la 0064 esta linea lanzaba:
  --   ERROR: update or delete on table "owners" violates foreign key constraint
  --          "consultations_owner_id_fkey" on table "consultations"
  delete from public.owners where id = v_duenoA;

  -- ── 3. La consulta sobrevivió, y sin titular ────────────────────────────────────────────────
  select count(*) into v_n from public.consultations where id = v_consulta;
  if v_n <> 1 then
    raise exception 'la consulta se borro: SET NULL deberia conservarla, no llevarsela';
  end if;

  select owner_id into v_owner_tras_borrado from public.consultations where id = v_consulta;
  if v_owner_tras_borrado is not null then
    raise exception 'la consulta quedo apuntando a un titular borrado: %', v_owner_tras_borrado;
  end if;

  -- ── 4. El caso NORMAL no cambió: el paciente de B se borra con B, y la consulta se va con el ──
  delete from public.owners where id = v_duenoB;
  select count(*) into v_n from public.patients where id = v_paciente;
  if v_n <> 0 then
    raise exception 'el cascade normal owners->patients dejo de funcionar';
  end if;
  select count(*) into v_n from public.consultations where id = v_consulta;
  if v_n <> 0 then
    raise exception 'la consulta debia irse con su paciente y quedo huerfana';
  end if;

  raise exception '=== 0064 OK === SET NULL declarado, borrado anomalo exitoso, consulta conservada sin titular, y cascade normal intacto';
end $$;
