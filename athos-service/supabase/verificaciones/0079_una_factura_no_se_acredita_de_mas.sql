-- Verificación de la 0079 — una factura no se acredita de más.
--
-- LO QUE MÁS IMPORTA PROBAR no es que rechace lo que se pasa, sino que DEJE PASAR lo legítimo: varias
-- notas crédito parciales sobre la misma factura son el caso normal desde el 23-ago, y un trigger
-- demasiado estricto rompería la funcionalidad que acaba de entrar. Por eso el primer caso emite dos
-- parciales que suman exacto y exige que las dos entren.
--
-- Después sí: que la que se pasa por un peso no entre, y que una nota que NO está emitida no cuente
-- —un borrador no acredita nada— porque si contara, dos borradores bloquearían una factura entera.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0079.

do $$
declare
  v_clinic   uuid;
  v_invoice  uuid;
  v_ok       boolean;
begin
  -- Un mundo mínimo y propio: no se toca ninguna factura real.
  insert into public.clinics (name, plan, subscription_status)
       values ('VERIFICACION 0079', 'pro', 'active') returning id into v_clinic;

  insert into public.invoices (clinic_id, status, doc_kind, total_cents, balance_cents)
       values (v_clinic, 'EMITIDA', 'POS', 100000, 100000) returning id into v_invoice;

  -- ── 1. DOS PARCIALES QUE SUMAN EXACTO: tienen que entrar ────────────────────────────────────
  -- `reason_text` es NOT NULL sin default, igual que `reason_code`. La primera versión de esta
  -- verificación lo omitía y moría en el primer insert sin llegar a ejercitar el trigger.
  insert into public.credit_notes (clinic_id, invoice_id, status, total_cents, reason_code, reason_text)
       values (v_clinic, v_invoice, 'EMITIDA', 60000, 'ANULACION', 'Verificación 0079');
  insert into public.credit_notes (clinic_id, invoice_id, status, total_cents, reason_code, reason_text)
       values (v_clinic, v_invoice, 'EMITIDA', 40000, 'ANULACION', 'Verificación 0079');

  select count(*) = 2 into v_ok
    from public.credit_notes where invoice_id = v_invoice and status = 'EMITIDA';
  if not v_ok then
    raise exception 'FALLA: el trigger bloqueó parciales legítimas que suman el total exacto';
  end if;

  -- ── 2. UN PESO DE MÁS NO ENTRA ──────────────────────────────────────────────────────────────
  begin
    insert into public.credit_notes (clinic_id, invoice_id, status, total_cents, reason_code, reason_text)
         values (v_clinic, v_invoice, 'EMITIDA', 1, 'ANULACION', 'Verificación 0079');
    raise exception 'FALLA: se pudo acreditar por encima del total de la factura';
  exception when check_violation then
    null; -- Correcto: es lo que tiene que pasar.
  end;

  -- ── 3. UNA NOTA NO EMITIDA NO CUENTA ────────────────────────────────────────────────────────
  -- Un borrador no acredita nada. Si contara, dos borradores dejarían la factura sin poder
  -- acreditarse aunque no se haya emitido una sola nota.
  insert into public.credit_notes (clinic_id, invoice_id, status, total_cents, reason_code, reason_text)
       values (v_clinic, v_invoice, 'BORRADOR', 50000, 'ANULACION', 'Verificación 0079');

  raise exception 'VERIFICACION 0079 OK — los 3 casos pasaron. Todo revertido.';
end $$;
