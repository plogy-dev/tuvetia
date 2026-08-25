-- Verificación de la 0088 — los planes de salud.
--
-- LO QUE MÁS IMPORTA PROBAR es el TOPE: un plan que deja consumir cuatro consultas de tres es un
-- servicio regalado que nadie factura y nadie nota hasta que las cuentas del mes no cuadran. Se
-- prueba que deja pasar lo que cabe, que rechaza lo que se pasa, y que rechaza lo que ni siquiera
-- está en el plan.
--
-- Y que las tablas nuevas NO rompieron nada de lo que ya había: la 0088 sólo agrega, pero un
-- `on delete restrict` mal puesto podría impedir borrar un ítem del catálogo.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0088.

do $$
declare
  v_clinic   uuid;
  v_owner    uuid;
  v_paciente uuid;
  v_servicio uuid;
  v_otro     uuid;
  v_plan     uuid;
  v_contrato uuid;
  v_ok       boolean;
begin
  insert into public.clinics (name, plan, subscription_status)
       values ('VERIFICACION 0088', 'pro', 'active') returning id into v_clinic;

  insert into public.owners (clinic_id, full_name)
       values (v_clinic, 'Titular de prueba') returning id into v_owner;

  insert into public.patients (clinic_id, owner_id, name, species)
       values (v_clinic, v_owner, 'Milo', 'Perro') returning id into v_paciente;

  insert into public.catalog_items (clinic_id, item_type, name, price_cents)
       values (v_clinic, 'SERVICIO', 'Consulta general', 8000000) returning id into v_servicio;
  insert into public.catalog_items (clinic_id, item_type, name, price_cents)
       values (v_clinic, 'SERVICIO', 'Cirugia', 50000000) returning id into v_otro;

  -- ── 1. SE PUEDE ARMAR UN PLAN ───────────────────────────────────────────────────────────────
  insert into public.health_plans (clinic_id, name, price_cents, months)
       values (v_clinic, 'Plan bienestar anual', 30000000, 12) returning id into v_plan;
  insert into public.health_plan_items (plan_id, catalog_item_id, qty)
       values (v_plan, v_servicio, 3);
  raise notice '1 OK — plan armado con 3 consultas';

  -- ── 2. EL MISMO SERVICIO NO ENTRA DOS VECES ─────────────────────────────────────────────────
  -- Seria ambiguo: 2+3 o se pisan. Se resuelve con una fila por servicio y su cantidad.
  v_ok := false;
  begin
    insert into public.health_plan_items (plan_id, catalog_item_id, qty)
         values (v_plan, v_servicio, 2);
  exception when unique_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLA 2 — el mismo servicio entro dos veces al mismo plan';
  end if;
  raise notice '2 OK — un servicio, una fila';

  -- ── 3. SE CONTRATA PARA UN PACIENTE ─────────────────────────────────────────────────────────
  insert into public.patient_health_plans
         (clinic_id, patient_id, plan_id, price_cents, starts_on, ends_on)
       values (v_clinic, v_paciente, v_plan, 30000000, current_date, current_date + 365)
    returning id into v_contrato;
  raise notice '3 OK — plan contratado';

  -- ── 4. LO QUE CABE, ENTRA ───────────────────────────────────────────────────────────────────
  insert into public.health_plan_uses (patient_health_plan_id, catalog_item_id, qty)
       values (v_contrato, v_servicio, 2);
  insert into public.health_plan_uses (patient_health_plan_id, catalog_item_id, qty)
       values (v_contrato, v_servicio, 1);
  raise notice '4 OK — las 3 consultas incluidas se pudieron consumir';

  -- ── 5. LA CUARTA NO ─────────────────────────────────────────────────────────────────────────
  -- Es el caso que justifica el trigger entero.
  v_ok := false;
  begin
    insert into public.health_plan_uses (patient_health_plan_id, catalog_item_id, qty)
         values (v_contrato, v_servicio, 1);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLA 5 — se consumio una consulta MAS de las incluidas';
  end if;
  raise notice '5 OK — el tope muerde';

  -- ── 6. UN SERVICIO QUE NO ESTA EN EL PLAN, TAMPOCO ──────────────────────────────────────────
  -- Sin esto, el plan cubriria cualquier cosa con solo registrarla.
  v_ok := false;
  begin
    insert into public.health_plan_uses (patient_health_plan_id, catalog_item_id, qty)
         values (v_contrato, v_otro, 1);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLA 6 — se consumio un servicio que no esta en el plan';
  end if;
  raise notice '6 OK — solo cubre lo que incluye';

  -- ── 7. NO SE PUEDE BORRAR DEL CATALOGO ALGO QUE UN PLAN PROMETE ─────────────────────────────
  v_ok := false;
  begin
    delete from public.catalog_items where id = v_servicio;
  exception when foreign_key_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLA 7 — se borro del catalogo un servicio que un plan incluye';
  end if;
  raise notice '7 OK — el catalogo esta protegido';

  -- ── 8. LOS TOPES DEL PLAN ───────────────────────────────────────────────────────────────────
  v_ok := false;
  begin
    update public.health_plans set months = 0 where id = v_plan;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLA 8 — entro un plan de 0 meses';
  end if;

  v_ok := false;
  begin
    insert into public.patient_health_plans
           (clinic_id, patient_id, plan_id, price_cents, starts_on, ends_on)
         values (v_clinic, v_paciente, v_plan, 0, current_date, current_date - 1);
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLA 8 — entro un contrato que termina antes de empezar';
  end if;
  raise notice '8 OK — los topes muerden';

  -- ── 9. LAS CUATRO TABLAS TIENEN RLS ─────────────────────────────────────────────────────────
  -- Sin RLS, una clinica veria los planes de otra. Es el mismo aislamiento que el resto del
  -- esquema, y no puede quedar suelto por ser tablas nuevas.
  if (select count(*) from pg_tables
       where schemaname = 'public'
         and tablename in ('health_plans','health_plan_items','patient_health_plans','health_plan_uses')
         and rowsecurity) <> 4 then
    raise exception 'FALLA 9 — alguna tabla de planes quedo sin RLS';
  end if;
  raise notice '9 OK — las cuatro con RLS';

  raise exception 'VERIFICACION 0088 OK — todo revertido a proposito';
end $$;
