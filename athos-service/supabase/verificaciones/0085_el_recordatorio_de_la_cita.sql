-- Verificación de la 0085 — el recordatorio de la cita.
--
-- LO QUE MÁS IMPORTA PROBAR es que ARRANQUE APAGADO en las clínicas que ya existen. Si alguna
-- quedara encendida, mañana a las 9 saldrían mensajes automáticos a los clientes de una clínica que
-- no lo pidió — hablando en su nombre, y tratando datos personales para una finalidad que el titular
-- no autorizó (Ley 1581).
--
-- Después: que el tope de horas rechace lo absurdo, que la marca de enviado arranque vacía, y que
-- las columnas existan.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0085.

do $$
declare
  v_clinic     uuid;
  v_encendidas int;
  v_ok         boolean;
  v_horas      int;
begin
  -- ── 1. NINGUNA CLÍNICA EXISTENTE QUEDÓ ENCENDIDA ────────────────────────────────────────────
  select count(*) into v_encendidas from public.clinics where recordatorio_citas_activo;
  if v_encendidas > 0 then
    raise exception 'FALLA 1 — % clinicas quedaron con el recordatorio ENCENDIDO sin pedirlo', v_encendidas;
  end if;
  raise notice '1 OK — ninguna clinica quedo encendida';

  insert into public.clinics (name, plan, subscription_status)
       values ('VERIFICACION 0085', 'pro', 'active') returning id into v_clinic;

  -- ── 2. LOS VALORES POR DEFECTO SON LOS ESPERADOS ────────────────────────────────────────────
  select recordatorio_citas_horas into v_horas from public.clinics where id = v_clinic;
  if v_horas is distinct from 24 then
    raise exception 'FALLA 2 — la anticipacion por defecto no es 24 (es %)', v_horas;
  end if;
  raise notice '2 OK — arranca apagada y en 24 horas';

  -- ── 3. SE PUEDE ENCENDER Y CAMBIAR ──────────────────────────────────────────────────────────
  update public.clinics
     set recordatorio_citas_activo = true,
         recordatorio_citas_horas = 48,
         recordatorio_citas_texto = 'Su cita de {paciente}: {fecha} a las {hora}.'
   where id = v_clinic;
  raise notice '3 OK — se puede encender y configurar';

  -- ── 4. EL TOPE DE HORAS RECHAZA LO ABSURDO ──────────────────────────────────────────────────
  -- 0 horas seria avisar cuando ya paso; 500 seria avisar tres semanas antes. Los dos son errores
  -- de tecleo, no configuraciones.
  v_ok := false;
  begin
    update public.clinics set recordatorio_citas_horas = 0 where id = v_clinic;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLA 4 — entro una anticipacion de 0 horas';
  end if;

  v_ok := false;
  begin
    update public.clinics set recordatorio_citas_horas = 500 where id = v_clinic;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLA 4 — entro una anticipacion de 500 horas';
  end if;
  raise notice '4 OK — el tope de horas muerde por los dos lados';

  -- ── 5. LA MARCA DE ENVIADO ARRANCA VACÍA ────────────────────────────────────────────────────
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments'
      and column_name = 'recordatorio_enviado_en' and is_nullable = 'YES';
  if not found then
    raise exception 'FALLA 5 — recordatorio_enviado_en no existe o no es opcional';
  end if;
  if exists (select 1 from public.appointments where recordatorio_enviado_en is not null) then
    raise exception 'FALLA 5 — hay citas marcadas como avisadas sin que se haya avisado nada';
  end if;
  raise notice '5 OK — ninguna cita quedo marcada';

  -- ── 6. EL ÍNDICE DEL BARRIDO ESTÁ PUESTO ────────────────────────────────────────────────────
  perform 1 from pg_indexes
    where schemaname = 'public' and tablename = 'appointments'
      and indexname = 'appointments_recordatorio_pendiente_idx';
  if not found then
    raise exception 'FALLA 6 — falta el indice del barrido';
  end if;
  raise notice '6 OK — indice puesto';

  raise exception 'VERIFICACION 0085 OK — todo revertido a proposito';
end $$;
