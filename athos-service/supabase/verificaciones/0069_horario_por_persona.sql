-- Verificación de la 0069 — el horario deja de ser el de la clínica y pasa a ser el de cada quien.
--
-- LO QUE HAY QUE PROBAR ES QUE CONVIVAN. La migración reemplaza UNA restricción única
-- —`(clinic_id, weekday, opens_at)`— por DOS índices parciales, uno para el horario de la clínica
-- (`vet_id is null`) y otro para el de cada persona. Si la vieja no se llegó a quitar, el horario
-- propio de un vet choca con el de la clínica en el mismo día y a la misma hora, y el vet no puede
-- guardar el suyo: el síntoma es "no me deja poner mi horario" sin ningún error que lo explique.
--
-- Y NO SE PUEDE MIRAR EL CATÁLOGO Y YA: el `do $$` que borra la vieja la busca POR SUS COLUMNAS,
-- no por nombre. Si esa consulta no la encontró —le pasó una vez, por el `::text` que falta en el
-- comentario de la migración—, corrió sin error y no borró nada.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0069.

do $$
declare
  v_clinic uuid;
  v_vetA   uuid;
  v_vetB   uuid;
  v_dia    smallint := 3;      -- un miércoles cualquiera
  v_abre   time := '07:11';    -- una hora que nadie usa, para no chocar con datos reales
  v_n      int;
begin
  select id into v_clinic from public.clinics order by created_at limit 1;
  select id into v_vetA from public.profiles where clinic_id = v_clinic order by created_at limit 1;
  if v_clinic is null or v_vetA is null then
    raise exception 'hace falta una clinica con al menos un perfil';
  end if;

  -- ── 1. La columna existe y admite nulo ──────────────────────────────────────────────────────
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'clinic_hours' and column_name = 'vet_id'
  ) then
    raise exception 'falta clinic_hours.vet_id: la 0069 no esta aplicada';
  end if;

  -- ── 2. EL HORARIO DE LA CLÍNICA Y EL DE UNA PERSONA CONVIVEN ────────────────────────────────
  --
  -- Mismo día, misma hora de apertura. Con la restricción vieja todavía puesta, el segundo insert
  -- falla — y eso es exactamente lo que la 0069 vino a permitir.
  insert into public.clinic_hours (clinic_id, weekday, opens_at, closes_at, vet_id)
  values (v_clinic, v_dia, v_abre, '17:11', null);

  insert into public.clinic_hours (clinic_id, weekday, opens_at, closes_at, vet_id)
  values (v_clinic, v_dia, v_abre, '15:11', v_vetA);

  -- ── 3. Pero cada uno sigue siendo único POR SEPARADO ────────────────────────────────────────
  --
  -- Los dos índices parciales tienen que seguir impidiendo el duplicado dentro de su propio
  -- ámbito. Sin esto, "quitar la restricción vieja" habría dejado la tabla sin ninguna.
  begin
    insert into public.clinic_hours (clinic_id, weekday, opens_at, closes_at, vet_id)
    values (v_clinic, v_dia, v_abre, '18:11', null);
    raise exception 'se pudo duplicar el horario DE LA CLINICA: falta el indice parcial de vet_id null';
  exception
    when unique_violation then null;
  end;

  begin
    insert into public.clinic_hours (clinic_id, weekday, opens_at, closes_at, vet_id)
    values (v_clinic, v_dia, v_abre, '16:11', v_vetA);
    raise exception 'se pudo duplicar el horario DE LA PERSONA: falta el indice parcial de vet_id no nulo';
  exception
    when unique_violation then null;
  end;

  -- ── 4. Y OTRA persona puede tener el suyo el mismo día y a la misma hora ─────────────────────
  select id into v_vetB from public.profiles
   where clinic_id = v_clinic and id <> v_vetA order by created_at limit 1;
  if v_vetB is not null then
    insert into public.clinic_hours (clinic_id, weekday, opens_at, closes_at, vet_id)
    values (v_clinic, v_dia, v_abre, '14:11', v_vetB);
  end if;

  select count(*) into v_n from public.clinic_hours
   where clinic_id = v_clinic and weekday = v_dia and opens_at = v_abre;

  raise exception '=== 0069 OK === el horario de la clinica y el de cada persona conviven (% filas), y cada ambito sigue siendo unico. Se revierte.', v_n;
end $$;
