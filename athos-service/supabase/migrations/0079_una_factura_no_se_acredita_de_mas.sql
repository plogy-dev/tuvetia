-- Ninguna factura puede quedar acreditada por más de lo que vale.
--
-- ── POR QUÉ NO ALCANZA CON LA COMPROBACIÓN QUE YA HAY ─────────────────────────────────────────
--
-- `anularFactura` suma las notas crédito EMITIDAS de la factura, calcula cuánto queda por acreditar
-- y rechaza lo que se pase. Es correcto y sigue estando: da el mensaje bueno, en español, antes de
-- tocar el consecutivo fiscal.
--
-- Pero es un LEER-Y-DESPUÉS-ESCRIBIR sin nada que lo sostenga. Dos peticiones sobre la misma factura
-- —dos pestañas, dos personas del mostrador, un doble envío— leen las dos ANTES de que cualquiera
-- inserte, las dos ven el saldo entero disponible, las dos pasan la comprobación, y las dos escriben.
-- Una factura de $100.000 termina con $120.000 acreditados. El comentario del archivo dice que el
-- tope lo impide; sin esto, no lo impide: lo hace improbable.
--
-- Lo encontró un review el 23-ago, el mismo día que las notas crédito parciales entraron a
-- producción. Con una sola nota por factura el problema no existía.
--
-- ── POR QUÉ UN TRIGGER Y NO UN CHECK ──────────────────────────────────────────────────────────
--
-- Un `CHECK` sólo puede mirar la fila que se está insertando. Acá la regla es sobre la SUMA de todas
-- las notas de esa factura contra el total de la factura, que son otras dos tablas: eso no cabe en
-- un CHECK y sí en un trigger.
--
-- ── QUÉ NO HACE ───────────────────────────────────────────────────────────────────────────────
--
-- No reemplaza la comprobación de la aplicación ni la vuelve redundante. Ésta es la red de abajo: el
-- mensaje que produce es para un log, no para un veterinario. Si esta excepción salta en producción
-- es porque hubo una carrera real, y eso merece mirarse.
--
-- Aplicar en el principal (`auxlnexhkmtoedrzfsnz`). Reversible: basta con borrar el trigger.

create or replace function private.la_nota_credito_cabe_en_la_factura()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_total_factura bigint;
  v_ya_acreditado bigint;
begin
  -- Una nota que no está EMITIDA no acredita nada todavía (borrador, rechazada por la DIAN).
  if new.status is distinct from 'EMITIDA' then
    return new;
  end if;

  select total_cents into v_total_factura
    from public.invoices
   where id = new.invoice_id;

  -- Sin factura no hay nada que comparar: esa integridad la cuida la clave foránea, no esto.
  if v_total_factura is null then
    return new;
  end if;

  -- `FOR UPDATE` sobre la factura: es lo que SERIALIZA a dos inserciones simultáneas. Sin el
  -- bloqueo, dos transacciones leerían la misma suma y las dos pasarían — exactamente el problema
  -- que este trigger viene a cerrar.
  perform 1 from public.invoices where id = new.invoice_id for update;

  select coalesce(sum(total_cents), 0) into v_ya_acreditado
    from public.credit_notes
   where invoice_id = new.invoice_id
     and status = 'EMITIDA'
     and id is distinct from new.id;

  if v_ya_acreditado + new.total_cents > v_total_factura then
    raise exception
      'La nota crédito excede lo acreditable de la factura %: total %, ya acreditado %, intento %',
      new.invoice_id, v_total_factura, v_ya_acreditado, new.total_cents
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function private.la_nota_credito_cabe_en_la_factura() is
  'Impide que la suma de notas crédito EMITIDAS supere el total de la factura. Ver 0079.';

drop trigger if exists credit_notes_caben_en_la_factura on public.credit_notes;

create trigger credit_notes_caben_en_la_factura
  before insert or update on public.credit_notes
  for each row
  execute function private.la_nota_credito_cabe_en_la_factura();
