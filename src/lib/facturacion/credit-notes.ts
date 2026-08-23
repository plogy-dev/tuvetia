// La nota crédito: lo único que corrige una factura ya emitida. TOTAL (anula) o PARCIAL (ajusta).
//
// POR QUÉ EXISTE ESTE ARCHIVO. Hasta el 2026-08-23 una factura emitida era PERMANENTE: la pantalla
// advertía "solo se corrige con nota crédito", la tabla `credit_notes` estaba creada con su CHECK de
// motivos DIAN, el prefijo `SNC` estaba en `constants.ts`, `FiscalProvider.submitCreditNote` estaba
// declarado y el sandbox lo implementaba… y no había una sola línea que emitiera una. Todo el
// andamiaje y ninguna salida. Si alguien se equivocaba delante de un cliente, no había arreglo.
//
// ── ES EL REVERSO DE LA EMISIÓN, NO UN CAMINO PARALELO ────────────────────────────────────────
//
// Reusa `ensureActiveRange`, la RPC `facturacion_assign_next_number` y `elRangoAvanzo` de
// `invoices.ts` en vez de repetirlos. La disciplina del consecutivo —atómico, nunca reutilizado, y
// preguntarle a la base cuándo la RPC falló de verdad en vez de adivinar por el mensaje de error—
// es idéntica para los dos documentos, y dos copias de eso divergen el día que alguien arregla una.
//
// ── TRES DECISIONES QUE NO SE VEN EN LA PANTALLA ──────────────────────────────────────────────
//
// 1. EL PAGO NO SE TOCA. Si la factura estaba pagada, ese dinero SE RECIBIÓ de verdad. La nota
//    crédito cancela lo que el cliente DEBE, no lo que ya entregó. Borrar el pago haría desaparecer
//    del sistema plata que entró a la caja — y dejaría a la clínica sin registro de que le debe una
//    devolución al titular. El saldo lo recalcula `deriveStatus`, que ya acota con `Math.max(0, …)`.
//
// 2. EL INVENTARIO SE DEVUELVE DE LO QUE PASÓ, NO DE LO QUE DEBERÍA HABER PASADO. Se leen los
//    movimientos reales de esa factura y se insertan sus opuestos exactos. Recalcularlos desde las
//    líneas daría distinto si alguien cambió la receta de un servicio o el ítem entre la emisión y
//    la anulación — y devolvería al stock una cantidad que nunca salió.
//
// 3. LA PARCIAL AJUSTA PLATA, NO STOCK. Sin saber QUÉ línea se acredita no hay forma de saber qué
//    volvió: $30.000 de una factura de $100.000 puede ser un descuento, un ajuste de precio o la
//    devolución de un producto. Devolver stock adivinando pondría en el inventario unidades que
//    siguen en la casa del cliente. Por eso el inventario se mueve SÓLO al anular, y la interfaz se
//    lo dice al vet cuando pide el monto. La nota crédito POR LÍNEA es lo que falta para cerrarlo.
//
// 4. VARIAS PARCIALES SOBRE LA MISMA FACTURA, con un techo: la suma de lo acreditado no puede pasar
//    el total. Sin ese tope, tres parciales de $40.000 sobre una factura de $100.000 acreditarían
//    $120.000 — más de lo que se cobró.
//
// 5. EL ESTADO SE DERIVA DEL EVENTO. No se escribe `credited_cents` a mano: se emite
//    `CREDIT_NOTE_APPLIED` con su importe y `refreshInvoiceStatus` recompone las cuatro dimensiones.
//    Escribirlo a mano dejaría la fila y sus eventos contando cosas distintas, que es exactamente lo
//    que esa máquina de estados viene a impedir.

import type { SupabaseClient } from '@supabase/supabase-js';

import { getFiscalProvider } from './fiscal/factory';
import type { FiscalCreditNoteSubmission, FiscalResult } from './fiscal/types';
import { appendEvent, ensureActiveRange, elRangoAvanzo, refreshInvoiceStatus } from './invoices';

/** Los motivos DIAN, espejo del CHECK de `credit_notes.reason_code`. */
export const MOTIVOS_NOTA_CREDITO = {
  ANULACION: 'Anulación de la factura',
  DEVOLUCION: 'Devolución de productos o servicios',
  DESCUENTO: 'Rebaja o descuento',
  AJUSTE_PRECIO: 'Ajuste de precio',
  OTROS: 'Otros',
} as const;

export type MotivoNotaCredito = keyof typeof MOTIVOS_NOTA_CREDITO;

export function esMotivoValido(v: string): v is MotivoNotaCredito {
  return v in MOTIVOS_NOTA_CREDITO;
}

export interface AnularRequest {
  invoiceId: string;
  motivo: MotivoNotaCredito;
  /** Detalle libre del vet. Opcional, pero es lo que explica el motivo dentro de seis meses. */
  detalle?: string | null;
  /**
   * Cuánto acreditar. Sin valor = el total de la factura, o sea la ANULACIÓN.
   *
   * Con valor menor al saldo acreditable, es una nota crédito PARCIAL: corrige el importe sin
   * anular el documento. La factura sigue EMITIDA y su saldo baja.
   */
  montoCents?: number | null;
  createdBy?: string | null;
}

export interface AnularResult {
  creditNoteId: string;
  fullNumber: string;
  /** Lo acreditado por ESTA nota. */
  totalCents: number;
  /** Si dejó la factura anulada (acreditó todo lo que quedaba) o sólo le bajó el saldo. */
  anulada: boolean;
  /** Lo que todavía se puede acreditar después de ésta. */
  acreditableRestante: number;
  cufe: string | null;
  fiscalStatus: string;
  providerMessage: string;
  movimientosDevueltos: number;
}

export async function anularFactura(
  supabase: SupabaseClient,
  clinicId: string,
  req: AnularRequest,
  now = new Date(),
): Promise<AnularResult> {
  // ── 1. La factura, y las guardas ────────────────────────────────────────────────────────────
  const { data: invRow, error: invErr } = await supabase
    .from('invoices')
    .select('id, clinic_id, status, doc_kind, full_number, total_cents, payer_id')
    .eq('id', req.invoiceId)
    .eq('clinic_id', clinicId)
    .maybeSingle();
  if (invErr) throw new Error(`No se pudo leer la factura: ${invErr.message}`);
  if (!invRow) throw new Error('Factura no encontrada');
  const invoice = invRow as {
    id: string;
    status: string;
    doc_kind: string;
    full_number: string | null;
    total_cents: number;
    payer_id: string | null;
  };

  // Un BORRADOR no se anula: se descarta (`discardDraft`), y así no quema un consecutivo de nota
  // crédito para deshacer algo que nunca llegó a existir fiscalmente.
  if (invoice.status === 'BORRADOR') {
    throw new Error('Un borrador no se anula: se descarta. La nota crédito es para lo ya emitido.');
  }
  if (invoice.status !== 'EMITIDA') {
    throw new Error(`Solo se puede anular una factura EMITIDA (está en ${invoice.status}).`);
  }

  // ── LO YA ACREDITADO, que es lo que vuelve seguras a las parciales ─────────────────────────
  //
  // Una factura puede tener VARIAS notas crédito parciales, así que "¿ya tiene una?" dejó de ser la
  // pregunta. La pregunta es cuánto queda por acreditar: sin este tope, tres parciales de $40.000
  // sobre una factura de $100.000 acreditarían $120.000 — más de lo que se cobró, y el saldo del
  // cliente quedaría a favor de la nada.
  //
  // Se consulta ANTES de tocar el rango, por lo mismo de siempre: un consecutivo consumido no se
  // devuelve. Y también es lo que impide que dos clics acrediten dos veces.
  const { data: previas } = await supabase
    .from('credit_notes')
    .select('total_cents')
    .eq('clinic_id', clinicId)
    .eq('invoice_id', invoice.id)
    .eq('status', 'EMITIDA');
  const yaAcreditado = (previas ?? []).reduce(
    (acc, n) => acc + Number((n as { total_cents: number }).total_cents),
    0,
  );
  const acreditable = invoice.total_cents - yaAcreditado;
  if (acreditable <= 0) {
    throw new Error('Esta factura ya está acreditada por completo.');
  }

  const monto = req.montoCents == null ? acreditable : Math.round(req.montoCents);
  if (monto <= 0) {
    throw new Error('El monto a acreditar tiene que ser mayor que cero.');
  }
  if (monto > acreditable) {
    throw new Error(
      `No se puede acreditar más de lo que queda: el máximo es ${acreditable / 100} y ya hay ${yaAcreditado / 100} acreditado.`,
    );
  }
  // Anula sólo si se lleva TODO lo que quedaba. Una parcial deja la factura viva y con menos saldo.
  const anula = monto === acreditable;

  // ── 2. El consecutivo, con la misma disciplina que la emisión ───────────────────────────────
  const range = await ensureActiveRange(supabase, clinicId, 'NOTA_CREDITO', req.createdBy);
  const numeroAntes = range.current_number;

  const { data: numberData, error: numErr } = await supabase.rpc(
    'facturacion_assign_next_number',
    { p_range_id: range.id },
  );
  if (numErr) {
    // Igual que en la emisión: un fallo de red y un "rango agotado" llegan idénticos, y la
    // diferencia decide si el número se consumió. Se le pregunta a la base.
    const consumido = await elRangoAvanzo(supabase, range.id, numeroAntes);
    if (consumido) {
      console.error(
        `[facturacion] la anulacion de ${invoice.id} consumio un consecutivo del rango ${range.id} y no se pudo confirmar. No reintentar sin revisar.`,
        numErr,
      );
      throw new Error(
        'El consecutivo de la nota crédito se asignó pero no se pudo confirmar. No reintentes: avisá al equipo para no saltar un número.',
      );
    }
    throw new Error(`No se pudo asignar el consecutivo de la nota crédito: ${numErr.message}`);
  }
  const number = Number(numberData);
  const fullNumber = range.prefix ? `${range.prefix}-${number}` : String(number);

  // ── 3. La nota crédito ──────────────────────────────────────────────────────────────────────
  const { data: cnRow, error: cnErr } = await supabase
    .from('credit_notes')
    .insert({
      clinic_id: clinicId,
      created_by: req.createdBy ?? null,
      invoice_id: invoice.id,
      numbering_range_id: range.id,
      number,
      full_number: fullNumber,
      status: 'EMITIDA',
      reason_code: req.motivo,
      reason_text: req.detalle?.trim() || MOTIVOS_NOTA_CREDITO[req.motivo],
      total_cents: monto,
      issued_at: now.toISOString(),
    })
    .select('id')
    .single();
  if (cnErr) throw new Error(`No se pudo crear la nota crédito: ${cnErr.message}`);
  const creditNoteId = (cnRow as { id: string }).id;

  // ── 4. Devolver el inventario: los opuestos EXACTOS de lo que salió ─────────────────────────
  //
  // ⚠️ SÓLO AL ANULAR. Una nota crédito PARCIAL no mueve stock, y no es un olvido: sin decir QUÉ
  // línea se acredita no hay forma de saber qué volvió. Acreditar $30.000 de una factura de
  // $100.000 puede ser un descuento (no volvió nada), un ajuste de precio (no volvió nada) o la
  // devolución de un producto (volvió uno) — y devolver stock adivinando pondría en el inventario
  // unidades que siguen en la casa del cliente.
  //
  // La parcial ajusta PLATA. Si volvió mercancía, el vet registra la devolución en inventario, que
  // es una pantalla que ya existe. Lo dice la interfaz al pedir el monto.
  //
  // Lo que falta para cerrarlo del todo es la nota crédito POR LÍNEA — elegir qué renglones se
  // acreditan y con qué cantidad. Ahí el stock sí se puede calcular, y queda anotado en ESTADO.md.
  const { data: salidas } = anula
    ? await supabase
    .from('inventory_movements')
    .select('item_id, lot_id, qty')
    .eq('clinic_id', clinicId)
    .eq('ref_type', 'INVOICE')
    .eq('ref_id', invoice.id)
    : { data: [] };

  const devoluciones = (salidas ?? []).map((m) => {
    const s = m as { item_id: string; lot_id: string | null; qty: number };
    return {
      clinic_id: clinicId,
      created_by: req.createdBy ?? null,
      item_id: s.item_id,
      lot_id: s.lot_id,
      qty: -Number(s.qty), // el opuesto exacto: si salieron 2, vuelven 2
      movement_type: 'DEVOLUCION',
      ref_type: 'INVOICE',
      ref_id: invoice.id,
      note: `Nota crédito ${fullNumber}`,
    };
  });
  if (devoluciones.length > 0) {
    const { error: movErr } = await supabase.from('inventory_movements').insert(devoluciones);
    if (movErr) throw new Error(`No se pudo devolver el inventario: ${movErr.message}`);
  }

  // ── 5. El documento fiscal ──────────────────────────────────────────────────────────────────
  const [{ data: settingsRow }, { data: payerRow }, { data: fiscalDoc }] = await Promise.all([
    supabase.from('billing_settings').select('*').eq('clinic_id', clinicId).maybeSingle(),
    invoice.payer_id
      ? supabase
          .from('billing_payers')
          .select('name, doc_type, doc_number, email')
          .eq('id', invoice.payer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('fiscal_documents')
      .select('cufe')
      .eq('invoice_id', invoice.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const settings = (settingsRow ?? {}) as Record<string, string | null>;
  const payer = (payerRow ?? null) as {
    name: string;
    doc_type: string;
    doc_number: string;
    email: string | null;
  } | null;

  const submission: FiscalCreditNoteSubmission = {
    fullNumber,
    invoiceFullNumber: invoice.full_number ?? '',
    invoiceCufe: (fiscalDoc as { cufe: string | null } | null)?.cufe ?? null,
    reason: req.detalle?.trim() || MOTIVOS_NOTA_CREDITO[req.motivo],
    totalCents: monto,
    emitter: {
      name: settings.fiscal_name ?? 'Emisor sin configurar',
      idType: settings.fiscal_id_type ?? 'CC',
      idNumber: settings.fiscal_id_number ?? '',
      regime: settings.fiscal_regime,
      address: settings.fiscal_address,
      municipalityCode: settings.municipality_code,
    },
    buyer: {
      fullName: payer?.name ?? 'Consumidor final',
      docType: payer?.doc_type ?? 'CC',
      docNumber: payer?.doc_number ?? '222222222222',
      email: payer?.email ?? null,
    },
  };

  const provider = await getFiscalProvider(supabase, clinicId);
  let fiscalResult: FiscalResult | null = null;
  let providerError: string | null = null;
  try {
    fiscalResult = await provider.submitCreditNote(submission);
  } catch (e) {
    // NO se relanza: la nota crédito YA tiene consecutivo y ya está en la base. Que el proveedor
    // esté caído no puede desandar eso — queda PENDIENTE, igual que en la emisión.
    providerError = e instanceof Error ? e.message : String(e);
  }

  await supabase.from('fiscal_documents').insert({
    clinic_id: clinicId,
    created_by: req.createdBy ?? null,
    invoice_id: invoice.id,
    provider: provider.name,
    doc_kind: 'NOTA_CREDITO',
    status: fiscalResult ? fiscalResult.status : 'PENDIENTE',
    cufe: fiscalResult?.cufe ?? null,
    request_payload: submission as unknown as Record<string, unknown>,
    response_payload: fiscalResult
      ? { message: fiscalResult.providerMessage, providerRef: fiscalResult.providerRef }
      : { error: providerError },
    attempts: 1,
    last_error: providerError,
    submitted_at: now.toISOString(),
    accepted_at: fiscalResult?.accepted ? now.toISOString() : null,
  });

  // ── 6. El evento, que es lo que mueve el estado ─────────────────────────────────────────────
  //
  // `amountCents` es la clave que lee `deriveStatus` para acumular `creditedCents`. Con el total de
  // la factura, el saldo queda en 0 y la dimensión fiscal pasa a AFECTADA_POR_NOTA_CREDITO.
  await appendEvent(supabase, invoice.id, 'CREDIT_NOTE_APPLIED', {
    amountCents: monto,
    creditNoteId,
    fullNumber,
    motivo: req.motivo,
  });

  // ANULADA sólo cuando se acreditó todo. Una parcial deja la factura EMITIDA a propósito: el
  // documento sigue siendo válido, con menos saldo. La dimensión fiscal ya pasa a
  // AFECTADA_POR_NOTA_CREDITO por el evento, que es lo que dice "esta factura tiene notas encima".
  if (anula) {
    const { error: stErr } = await supabase
      .from('invoices')
      .update({ status: 'ANULADA' })
      .eq('id', invoice.id)
      .eq('clinic_id', clinicId)
      .eq('status', 'EMITIDA');
    if (stErr) throw new Error(`No se pudo marcar la factura como anulada: ${stErr.message}`);
  }

  const derived = await refreshInvoiceStatus(supabase, clinicId, invoice.id, now);

  return {
    creditNoteId,
    fullNumber,
    totalCents: monto,
    anulada: anula,
    acreditableRestante: acreditable - monto,
    cufe: fiscalResult?.cufe ?? null,
    fiscalStatus: derived.fiscal,
    providerMessage: fiscalResult?.providerMessage ?? `Proveedor no disponible: ${providerError}`,
    movimientosDevueltos: devoluciones.length,
  };
}
