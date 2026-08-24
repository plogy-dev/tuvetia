-- Un descuento de factura no puede existir sin la razón por la que se dio.
--
-- ── DE DÓNDE SALE ─────────────────────────────────────────────────────────────────────────────
--
-- Del pedido de copiar EXACTO el módulo de ventas de OkVet (David, 24-ago). En su modal «Nueva
-- cuenta» el campo se llama «Razón del descuento global» y su marca de agua dice, literal,
-- «Requerido al aplicar descuento global».
--
-- ── POR QUÉ VA EN LA BASE Y NO SÓLO EN EL FORMULARIO ──────────────────────────────────────────
--
-- Un descuento es la única forma en que sale plata de una venta sin que se registre como pago,
-- devolución ni nota crédito. Sin la razón, en el histórico queda un total más bajo y nadie puede
-- decir si fue una promoción, un acuerdo con el titular o un favor. La regla la pidió el cliente
-- como campo obligatorio; acá se sostiene donde no se puede esquivar: la pantalla valida para dar
-- un mensaje en español, y el CHECK garantiza que no exista la fila.
--
-- ── POR QUÉ TRES COLUMNAS Y NO UNA ────────────────────────────────────────────────────────────
--
-- `invoices.discount_cents` ya existe, pero es la SUMA de los descuentos de todas las líneas
-- —incluida la parte prorrateada del global—, así que mirándolo no se puede saber si hubo un
-- descuento de factura ni de cuánto fue. Sin guardar el global aparte, la pareja (monto, razón) no
-- se puede exigir: el CHECK no tendría contra qué comparar.
--
--   · `global_discount_cents`  — el descuento de FACTURA tal como se tecleó, antes de prorratear.
--   · `global_discount_reason` — por qué se dio. Obligatorio si el anterior no es cero.
--   · `reference`              — el campo «Referencia/Nombre» de OkVet (ref. de mascota, historia o
--                                un nombre libre). No es fiscal: es cómo el mostrador reconoce la
--                                cuenta cuando el titular no está registrado.
--
-- El prorrateo NO se guarda por separado: vive repartido en `invoice_lines.discount_cents`, que es
-- lo que la DIAN necesita (el impuesto se liquida por línea sobre su base).
--
-- ── EL CHECK ES NOT VALID A PROPÓSITO ─────────────────────────────────────────────────────────
--
-- Las filas que ya existen tienen `global_discount_cents = 0` por el DEFAULT, así que ninguna lo
-- viola y validarlo sería gratis. Va igual con `NOT VALID` + `VALIDATE` en dos pasos porque es el
-- hábito correcto en una tabla que crece: el ALTER no toma un lock de tabla completa mientras
-- verifica. Acá no cambia nada; el día que la tabla tenga millones de filas, sí.
--
-- Aplicar en el principal (`auxlnexhkmtoedrzfsnz`). Reversible: se borran las tres columnas.

alter table public.invoices
  add column if not exists global_discount_cents bigint not null default 0,
  add column if not exists global_discount_reason text,
  add column if not exists reference text;

alter table public.invoices
  drop constraint if exists invoices_descuento_global_con_razon;

alter table public.invoices
  add constraint invoices_descuento_global_con_razon
  check (
    global_discount_cents = 0
    or (global_discount_reason is not null and btrim(global_discount_reason) <> '')
  )
  not valid;

alter table public.invoices
  validate constraint invoices_descuento_global_con_razon;

-- El global nunca es negativo: un "descuento" negativo sería un recargo encubierto que no aparece
-- en ninguna línea y que el titular no vería explicado en su factura.
alter table public.invoices
  drop constraint if exists invoices_descuento_global_no_negativo;

alter table public.invoices
  add constraint invoices_descuento_global_no_negativo
  check (global_discount_cents >= 0);

comment on column public.invoices.global_discount_cents is
  'Descuento de FACTURA tal como se tecleó, antes de prorratear entre las líneas. El reparto vive en invoice_lines.discount_cents.';
comment on column public.invoices.global_discount_reason is
  'Por qué se dio el descuento de factura. Obligatorio cuando global_discount_cents > 0 (constraint invoices_descuento_global_con_razon).';
comment on column public.invoices.reference is
  'Campo «Referencia/Nombre» de la cuenta: ref. de mascota, historia o nombre libre. No es un dato fiscal.';
