-- Verificación de la 0082 — las plantillas son de cada clínica.
--
-- LO QUE MÁS IMPORTA PROBAR es que las clínicas que YA EXISTEN queden en NULL y no con una copia de
-- los textos actuales: NULL significa «uso los de por defecto», y es lo que permite mejorar la
-- redacción base más adelante sin dejar congelada a la clínica que nunca tocó nada.
--
-- Después: que acepte un objeto PARCIAL (sólo los pasos que la clínica cambió), que acepte el
-- objeto vacío, y que la columna siga siendo opcional.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0082.

do $$
declare
  v_clinic uuid;
  v_valor  jsonb;
  v_nulos  int;
begin
  -- ── 1. LAS CLÍNICAS QUE YA EXISTEN QUEDAN EN NULL ───────────────────────────────────────────
  -- Se mira ANTES de insertar nada propio, sobre las filas reales.
  select count(*) into v_nulos from public.billing_settings where reminder_templates is not null;
  if v_nulos > 0 then
    raise exception 'FALLA 1 — % clínicas quedaron con plantillas copiadas en vez de NULL', v_nulos;
  end if;
  raise notice '1 OK — ninguna clínica existente quedó con plantillas propias';

  insert into public.clinics (name, plan, subscription_status)
       values ('VERIFICACION 0082', 'pro', 'active') returning id into v_clinic;

  -- ── 2. SE PUEDE CREAR SIN PLANTILLAS: es el caso de todos los días ──────────────────────────
  insert into public.billing_settings (clinic_id) values (v_clinic);
  select reminder_templates into v_valor from public.billing_settings where clinic_id = v_clinic;
  if v_valor is not null then
    raise exception 'FALLA 2 — la columna no arranca en NULL';
  end if;
  raise notice '2 OK — arranca en NULL';

  -- ── 3. ACEPTA UN OBJETO PARCIAL ─────────────────────────────────────────────────────────────
  -- Cambiar un solo paso tiene que ser válido; los otros cuatro caen al texto por defecto.
  update public.billing_settings
     set reminder_templates = '{"RECORDATORIO_1": "Su factura {number} venció: {link}"}'::jsonb
   where clinic_id = v_clinic;
  select reminder_templates into v_valor from public.billing_settings where clinic_id = v_clinic;
  if v_valor -> 'RECORDATORIO_1' is null then
    raise exception 'FALLA 3 — no se guardó el paso cambiado';
  end if;
  if v_valor ? 'AVISO_SALDO' then
    raise exception 'FALLA 3 — apareció un paso que nadie escribió';
  end if;
  raise notice '3 OK — objeto parcial guardado tal cual';

  -- ── 4. ACEPTA EL OBJETO VACÍO Y VOLVER A NULL ───────────────────────────────────────────────
  -- «Restaurar los de por defecto» tiene que poder deshacer del todo.
  update public.billing_settings set reminder_templates = '{}'::jsonb where clinic_id = v_clinic;
  update public.billing_settings set reminder_templates = null where clinic_id = v_clinic;
  select reminder_templates into v_valor from public.billing_settings where clinic_id = v_clinic;
  if v_valor is not null then
    raise exception 'FALLA 4 — no se pudo volver a NULL';
  end if;
  raise notice '4 OK — se puede volver a los de por defecto';

  -- ── 5. LA COLUMNA EXISTE Y ES jsonb ─────────────────────────────────────────────────────────
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'billing_settings'
      and column_name = 'reminder_templates' and data_type = 'jsonb';
  if not found then
    raise exception 'FALLA 5 — reminder_templates no existe o no es jsonb';
  end if;
  raise notice '5 OK — la columna existe y es jsonb';

  -- Deshace TODO lo de arriba. La clínica de prueba no queda en la base.
  raise exception 'VERIFICACION 0082 OK — todo revertido a propósito';
end $$;
