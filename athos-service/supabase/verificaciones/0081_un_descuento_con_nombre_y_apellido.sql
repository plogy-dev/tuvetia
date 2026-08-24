-- Verificación de la 0081 — un descuento con nombre y apellido.
--
-- LO QUE MÁS IMPORTA PROBAR es que DEJE PASAR lo normal: la inmensa mayoría de las facturas no
-- llevan descuento de factura, y un CHECK mal escrito las bloquearía todas. Por eso el primer caso
-- es una factura sin descuento y sin razón, que es como se emite todos los días.
--
-- Después sí: que el descuento con razón entre, que el descuento SIN razón no entre, que una razón
-- de puros espacios cuente como ausente —que es el agujero por el que se cuela un formulario mal
-- validado— y que un descuento negativo se rechace.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0081.

do $$
declare
  v_clinic uuid;
  v_ok     boolean;
begin
  -- Un mundo mínimo y propio: no se toca ninguna factura real.
  insert into public.clinics (name, plan, subscription_status)
       values ('VERIFICACION 0081', 'pro', 'active') returning id into v_clinic;

  -- ── 1. SIN DESCUENTO Y SIN RAZÓN: el caso de todos los días, tiene que entrar ────────────────
  insert into public.invoices (clinic_id, status, doc_kind, total_cents, balance_cents)
       values (v_clinic, 'BORRADOR', 'POS', 100000, 100000);
  raise notice '1 OK — factura sin descuento entra sin razón';

  -- ── 2. CON DESCUENTO Y CON RAZÓN: tiene que entrar ──────────────────────────────────────────
  insert into public.invoices (clinic_id, status, doc_kind, total_cents, balance_cents,
                               global_discount_cents, global_discount_reason)
       values (v_clinic, 'BORRADOR', 'POS', 90000, 90000, 10000, 'Promoción de vacunación');
  raise notice '2 OK — descuento con razón entra';

  -- ── 3. CON DESCUENTO Y SIN RAZÓN: NO puede entrar ───────────────────────────────────────────
  v_ok := false;
  begin
    insert into public.invoices (clinic_id, status, doc_kind, total_cents, balance_cents,
                                 global_discount_cents)
         values (v_clinic, 'BORRADOR', 'POS', 90000, 90000, 10000);
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLA 3 — un descuento de factura entró SIN razón';
  end if;
  raise notice '3 OK — descuento sin razón rechazado';

  -- ── 4. RAZÓN DE PUROS ESPACIOS: cuenta como ausente ─────────────────────────────────────────
  -- Es el caso real: un campo obligatorio que el navegador da por lleno porque tiene un espacio.
  -- Sin el `btrim` del CHECK, éste pasaría y el histórico quedaría con un descuento sin explicar.
  v_ok := false;
  begin
    insert into public.invoices (clinic_id, status, doc_kind, total_cents, balance_cents,
                                 global_discount_cents, global_discount_reason)
         values (v_clinic, 'BORRADOR', 'POS', 90000, 90000, 10000, '   ');
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLA 4 — una razón de puros espacios pasó como razón';
  end if;
  raise notice '4 OK — razón en blanco rechazada';

  -- ── 5. DESCUENTO NEGATIVO: NO puede entrar ──────────────────────────────────────────────────
  v_ok := false;
  begin
    insert into public.invoices (clinic_id, status, doc_kind, total_cents, balance_cents,
                                 global_discount_cents, global_discount_reason)
         values (v_clinic, 'BORRADOR', 'POS', 110000, 110000, -10000, 'Recargo encubierto');
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLA 5 — un descuento negativo entró';
  end if;
  raise notice '5 OK — descuento negativo rechazado';

  -- ── 6. LAS TRES COLUMNAS EXISTEN CON EL TIPO ESPERADO ───────────────────────────────────────
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices'
      and column_name = 'global_discount_cents' and data_type = 'bigint';
  if not found then
    raise exception 'FALLA 6 — global_discount_cents no existe o no es bigint';
  end if;
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'reference';
  if not found then
    raise exception 'FALLA 6 — reference no existe';
  end if;
  raise notice '6 OK — las columnas existen';

  -- Deshace TODO lo de arriba. Las facturas y la clínica de prueba no quedan en la base.
  raise exception 'VERIFICACION 0081 OK — todo revertido a propósito';
end $$;
