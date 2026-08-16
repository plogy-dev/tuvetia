// Orquestación de facturación sobre Supabase. Port del repo cliente
// conservando el orden de consecuencias de la emisión: consecutivo → snapshot
// ya congelado → documento fiscal → movimientos de inventario → estados
// derivados. Tenancy por clinic_id (contrato §1); la autoría del usuario que
// emite/crea viaja en `createdBy` (columna created_by, nullable).
//
// supabase-js no expone transacciones multi-statement, así que la emisión es
// TOLERANTE A FALLOS por diseño en vez de atómica:
//   1. El borrador pasa a EMITIENDO con guarda optimista (update … eq status).
//   2. El consecutivo se asigna con la función SQL facturacion_assign_next_number
//      (atómica por row-lock) y JAMÁS se reutiliza, falle lo que falle después.
//   3. Si el proveedor fiscal falla, la factura queda EMITIDA con documento
//      fiscal PENDIENTE y el cron de reintentos (fase 1f) la retoma. Eso es
//      correcto según DIAN: el número ya está consumido.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildLineSnapshot,
  validateDraftInvoice,
  type LineInput,
  type ValidationIssue,
} from '@/lib/facturacion/domain/invoice';
import { finDelDiaBogota } from '@/lib/date-utils';
import { computeInvoiceTotals } from '@/lib/facturacion/domain/money';
import {
  deriveFollowupStatus,
  deriveStatus,
} from '@/lib/facturacion/domain/invoice-status';
import { saleMovementQty, validateMovementSign } from '@/lib/facturacion/domain/inventory';
import { computeRecipeConsumption } from '@/lib/facturacion/domain/recipes';
import { applyPaymentToInvoice } from '@/lib/facturacion/domain/payments';
import { checkPosThreshold, type PosThresholdCheck } from '@/lib/facturacion/domain/dian-rules';
import type {
  DocKind,
  FollowupStatus,
  InvoiceEventLike,
  InvoiceEventType,
  PaymentMethod,
  PaymentOutcome,
  TaxStatus,
} from '@/lib/facturacion/domain/types';
import type { InvoiceRow, NumberingRangeRow, PaymentTerms } from '@/lib/supabase/types';
import { getFiscalProvider } from './fiscal/factory';
import type { FiscalResult, FiscalSubmission } from './fiscal/types';
import {
  DEFAULT_UVT_VALUE_CENTS,
  SANDBOX_RANGE_FROM,
  SANDBOX_RANGE_PREFIX,
  SANDBOX_RANGE_TO,
} from './constants';
import {
  getActiveRange,
  getBillingSettings,
  getCatalogItems,
  getInvoiceDetail,
  getNearExpirySet,
  getPayer,
  getRecipesForServices,
  getStockMap,
} from './queries';

// ─── Líneas del carrito ──────────────────────────────────────────────────────

export interface DraftLineRequest {
  catalogItemId?: string | null;
  /** Solo para líneas manuales (sin ítem de catálogo). */
  description?: string;
  qty: number;
  /** Solo manuales: precio en centavos. Con catálogo se usa el del ítem. */
  unitPriceCents?: number;
  taxRate?: number;
  discountCents?: number;
}

interface EnrichedLine extends LineInput {
  taxStatus: TaxStatus;
}

async function enrichLines(
  supabase: SupabaseClient,
  clinicId: string,
  lines: DraftLineRequest[],
  now: Date,
): Promise<EnrichedLine[]> {
  const ids = lines.map((l) => l.catalogItemId).filter((x): x is string => !!x);
  const [items, stockMap, nearExpiry] = await Promise.all([
    getCatalogItems(supabase, clinicId, ids),
    getStockMap(supabase, clinicId, ids),
    getNearExpirySet(supabase, clinicId, ids, now),
  ]);

  return lines.map((l) => {
    if (l.catalogItemId) {
      const item = items.get(l.catalogItemId);
      if (!item) throw new Error(`Ítem de catálogo no encontrado: ${l.catalogItemId}`);
      return {
        catalogItemId: item.id,
        description: item.name,
        qty: l.qty,
        unit: item.use_unit,
        unitPriceCents: item.price_cents,
        taxRate: item.tax_rate,
        discountCents: l.discountCents ?? 0,
        costCents: item.cost_cents ?? undefined,
        trackStock: item.track_stock,
        stock: stockMap.get(item.id) ?? 0,
        nearExpiry: nearExpiry.has(item.id),
        taxStatus: item.tax_status,
      };
    }
    return {
      catalogItemId: null,
      description: l.description ?? '',
      qty: l.qty,
      unit: 'unidad',
      unitPriceCents: l.unitPriceCents ?? 0,
      taxRate: l.taxRate ?? 0,
      discountCents: l.discountCents ?? 0,
      taxStatus: (l.taxRate ?? 0) > 0 ? 'GRAVADO' : ('EXCLUIDO' as TaxStatus),
    };
  });
}

// ─── Borrador ────────────────────────────────────────────────────────────────

export interface DraftRequest {
  payerId: string;
  patientId?: string | null;
  consultationId?: string | null;
  docKind?: DocKind;
  lines: DraftLineRequest[];
  wantsElectronicDelivery?: boolean;
  /** Autoría (profiles.id) del usuario que crea el borrador; null = sistema. */
  createdBy?: string | null;
}

export interface DraftPreview {
  warnings: ValidationIssue[];
  blockers: ValidationIssue[];
  totals: ReturnType<typeof computeInvoiceTotals> | null;
  /** Aviso 5 UVT cuando el documento es POS (art. 616-1 ET). */
  posThreshold: PosThresholdCheck | null;
}

/** Validación + totales sin persistir. */
export async function previewDraft(
  supabase: SupabaseClient,
  clinicId: string,
  req: DraftRequest,
  now = new Date(),
): Promise<DraftPreview> {
  const payer = await getPayer(supabase, clinicId, req.payerId);
  if (!payer) throw new Error('Pagador no encontrado');
  const lines = await enrichLines(supabase, clinicId, req.lines, now);
  const settings = await getBillingSettings(supabase, clinicId);

  const validation = validateDraftInvoice({
    lines,
    buyer: {
      fullName: payer.name,
      docType: payer.doc_type,
      docNumber: payer.doc_number,
      email: payer.email,
    },
    wantsElectronicDelivery: req.wantsElectronicDelivery ?? false,
    role: 'ADMIN', // Tuvetia v1: quien factura opera como dueño de la práctica
    blockOnInsufficientStock: settings?.block_on_insufficient_stock ?? false,
  });

  const totals =
    validation.blockers.length === 0 && lines.length > 0
      ? computeInvoiceTotals(lines.map(buildLineSnapshot))
      : null;

  const docKind = req.docKind ?? settings?.default_doc_kind ?? 'POS';
  const posThreshold =
    totals && docKind === 'POS'
      ? checkPosThreshold(
          totals.subtotalCents - totals.discountCents,
          settings?.uvt_value_cents ?? DEFAULT_UVT_VALUE_CENTS,
        )
      : null;

  return { ...validation, totals, posThreshold };
}

/**
 * Crea el borrador con snapshot CONGELADO de líneas: cambios futuros de precio
 * en el catálogo no lo alteran. Sin transacción: si fallan las líneas se borra
 * el borrador (compensación) — un borrador no tiene consecuencias fiscales.
 */
export async function createDraftInvoice(
  supabase: SupabaseClient,
  clinicId: string,
  req: DraftRequest,
  now = new Date(),
): Promise<{ invoice: InvoiceRow; preview: DraftPreview }> {
  const preview = await previewDraft(supabase, clinicId, req, now);
  if (preview.blockers.length > 0) {
    throw new Error(
      `No se puede crear el borrador: ${preview.blockers.map((b) => b.message).join(' | ')}`,
    );
  }
  const lines = await enrichLines(supabase, clinicId, req.lines, now);
  const snapshots = lines.map((l) => ({ snap: buildLineSnapshot(l), taxStatus: l.taxStatus }));
  const totals = computeInvoiceTotals(snapshots.map((s) => s.snap));
  const settings = await getBillingSettings(supabase, clinicId);
  const docKind = req.docKind ?? settings?.default_doc_kind ?? 'POS';

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      clinic_id: clinicId,
      created_by: req.createdBy ?? null,
      doc_kind: docKind,
      status: 'BORRADOR',
      payer_id: req.payerId,
      patient_id: req.patientId ?? null,
      consultation_id: req.consultationId ?? null,
      subtotal_cents: totals.subtotalCents,
      discount_cents: totals.discountCents,
      tax_cents: totals.taxCents,
      total_cents: totals.totalCents,
      balance_cents: totals.totalCents,
    })
    .select('*')
    .single();
  if (invErr) throw new Error(`No se pudo crear el borrador: ${invErr.message}`);
  const inv = invoice as InvoiceRow;

  const { error: linesErr } = await supabase.from('invoice_lines').insert(
    snapshots.map((s, i) => ({
      invoice_id: inv.id,
      catalog_item_id: s.snap.catalogItemId,
      description: s.snap.description,
      qty: s.snap.qty,
      unit: s.snap.unit,
      unit_price_cents: s.snap.unitPriceCents,
      tax_rate: s.snap.taxRate,
      tax_status: s.taxStatus,
      discount_cents: s.snap.discountCents,
      subtotal_cents: s.snap.subtotalCents,
      tax_cents: s.snap.taxCents,
      total_cents: s.snap.totalCents,
      position: i,
    })),
  );
  if (linesErr) {
    await supabase.from('invoices').delete().eq('id', inv.id).eq('clinic_id', clinicId);
    throw new Error(`No se pudieron guardar las líneas: ${linesErr.message}`);
  }

  await appendEvent(supabase, inv.id, 'CREATED', { totalCents: totals.totalCents });
  return { invoice: inv, preview };
}

// ─── Eventos y estados derivados ─────────────────────────────────────────────

async function appendEvent(
  supabase: SupabaseClient,
  invoiceId: string,
  type: InvoiceEventType,
  payload?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('invoice_events')
    .insert({ invoice_id: invoiceId, event_type: type, payload: payload ?? null });
  if (error) throw new Error(`No se pudo registrar el evento ${type}: ${error.message}`);
}

/** Recalcula los cachés de estado de la factura desde sus eventos. */
export async function refreshInvoiceStatus(
  supabase: SupabaseClient,
  clinicId: string,
  invoiceId: string,
  now = new Date(),
) {
  const detail = await getInvoiceDetail(supabase, clinicId, invoiceId);
  if (!detail) throw new Error('Factura no encontrada');
  const events: InvoiceEventLike[] = detail.events.map((e) => ({
    type: e.event_type,
    createdAt: new Date(e.created_at),
    payload: e.payload ?? undefined,
  }));
  const derived = deriveStatus(events, {
    now,
    totalCents: detail.invoice.total_cents,
    // `due_date` es una columna DATE: `new Date('2026-08-15')` daba medianoche UTC = 19:00 del 14 en
    // Bogotá, y la factura se marcaba VENCIDA 29 horas antes. Vence al TERMINAR el día 15.
    dueDate: detail.invoice.due_date ? finDelDiaBogota(detail.invoice.due_date) : null,
  });
  // 4ª dimensión: el seguimiento se deriva del recaudo + los insumos del motor
  // de cartera: tarea humana abierta, canales revocados y envíos hechos.
  const ownerId = detail.payer?.owner_id ?? null;
  const [openTasksRes, sentRemindersRes, authsRes] = await Promise.all([
    supabase
      .from('human_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('invoice_id', invoiceId)
      .in('status', ['ABIERTA', 'EN_PROGRESO']),
    supabase
      .from('invoice_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('invoice_id', invoiceId)
      .eq('status', 'ENVIADO'),
    ownerId
      ? supabase
          .from('channel_authorizations')
          .select('granted, revoked_at')
          .eq('clinic_id', clinicId)
          .eq('owner_id', ownerId)
      : Promise.resolve({ data: [] }),
  ]);
  const auths =
    (authsRes as { data: Array<{ granted: boolean; revoked_at: string | null }> | null }).data ?? [];
  const activeAuth = auths.filter((a) => a.granted && a.revoked_at === null).length;
  const revokedAuth = auths.filter((a) => a.revoked_at !== null).length;
  const followup: FollowupStatus = deriveFollowupStatus({
    followupEnabled: detail.invoice.followup_enabled ?? true,
    followupRequired: detail.invoice.payment_terms === 'CREDIT',
    derived,
    hasOpenHumanTask: (openTasksRes.count ?? 0) > 0,
    anyReminderSent: (sentRemindersRes.count ?? 0) > 0,
    // "Todos los canales revocados": hubo autorizaciones y ninguna sigue vigente.
    allChannelsRevoked: activeAuth === 0 && revokedAuth > 0,
  });
  const { error } = await supabase
    .from('invoices')
    .update({
      fiscal_status: derived.fiscal,
      collection_status: derived.collection,
      delivery_status: derived.delivery,
      paid_cents: derived.paidCents,
      credited_cents: derived.creditedCents,
      balance_cents: derived.balanceCents,
      reminders_paused: derived.remindersPaused,
      followup_status: followup,
    })
    .eq('id', invoiceId)
    .eq('clinic_id', clinicId);
  if (error) throw new Error(`No se pudo actualizar el estado: ${error.message}`);
  return { ...derived, followup };
}

// ─── Registro de pago + imputación (compartido por emisión y pagos manuales) ─

async function insertPaymentWithApplication(
  supabase: SupabaseClient,
  clinicId: string,
  args: {
    invoiceId: string;
    invoiceTotalCents: number;
    alreadyPaidCents: number;
    creditedCents: number;
    method: PaymentMethod;
    amountCents: number;
    reference?: string | null;
    note?: string | null;
    createdBy?: string | null;
  },
  now: Date,
) {
  // El dominio rechaza sobrepago y pagos sobre facturas sin saldo.
  const application = applyPaymentToInvoice({
    invoiceTotalCents: args.invoiceTotalCents,
    alreadyPaidCents: args.alreadyPaidCents,
    creditedCents: args.creditedCents,
    paymentAmountCents: args.amountCents,
  });

  // RESERVA ATÓMICA antes de insertar nada.
  //
  // `applyPaymentToInvoice` valida el sobrepago contra `alreadyPaidCents`, que se LEYÓ antes — es un
  // TOCTOU. Dos pestañas con la misma factura abierta, ambas "Registrar pago" del saldo completo:
  // las dos leían 0, las dos pasaban la validación, y quedaban dos filas en `payments` con
  // `paid_cents = 2×total`. El badge decía "Pagada", el doble ingreso entraba a Finanzas, y NO había
  // vuelta atrás: `payments/actions.ts` se niega a borrar un pago ya aplicado.
  //
  // El compare-and-set sobre `paid_cents` deja pasar a una sola. El valor que escribe acá es
  // provisional: `refreshInvoiceStatus` lo recalcula después desde `payment_applications`, que es la
  // fuente de verdad. Esto es un cerrojo, no un cálculo.
  const { data: reserva, error: resErr } = await supabase
    .from('invoices')
    .update({ paid_cents: args.alreadyPaidCents + application.appliedCents })
    .eq('id', args.invoiceId)
    .eq('clinic_id', clinicId)
    .eq('paid_cents', args.alreadyPaidCents)
    .select('id');
  if (resErr) throw new Error(`No se pudo registrar el pago: ${resErr.message}`);
  if (!reserva || reserva.length === 0) {
    throw new Error(
      'Otro pago de esta factura se registró al mismo tiempo. Recargá para ver el saldo real antes de volver a cobrar.',
    );
  }

  try {
    const { data: payment, error: payErr } = await supabase
      .from('payments')
      .insert({
        clinic_id: clinicId,
        created_by: args.createdBy ?? null,
        method: args.method,
        amount_cents: args.amountCents,
        reference: args.reference ?? null,
        note: args.note ?? null,
        received_at: now.toISOString(),
      })
      .select('id')
      .single();
    if (payErr) throw new Error(`No se pudo registrar el pago: ${payErr.message}`);

    const { error: appErr } = await supabase.from('payment_applications').insert({
      payment_id: (payment as { id: string }).id,
      invoice_id: args.invoiceId,
      amount_cents: application.appliedCents,
    });
    if (appErr) throw new Error(`No se pudo aplicar el pago: ${appErr.message}`);

    await appendEvent(supabase, args.invoiceId, 'PAYMENT_APPLIED', {
      amountCents: application.appliedCents,
      method: args.method,
    });
    return application;
  } catch (e) {
    // La reserva no llegó a usarse: devolver el contador a lo que estaba, o la factura queda
    // marcada como cobrada sin que exista el pago — peor que el fallo original.
    await supabase
      .from('invoices')
      .update({ paid_cents: args.alreadyPaidCents })
      .eq('id', args.invoiceId)
      .eq('clinic_id', clinicId);
    throw e;
  }
}

// ─── Rango de numeración (auto-crea sandbox si no hay) ───────────────────────

async function ensureActiveRange(
  supabase: SupabaseClient,
  clinicId: string,
  docKind: DocKind,
  createdBy?: string | null,
): Promise<NumberingRangeRow> {
  const existing = await getActiveRange(supabase, clinicId, docKind);
  if (existing) return existing;
  const { data, error } = await supabase
    .from('numbering_ranges')
    .insert({
      clinic_id: clinicId,
      created_by: createdBy ?? null,
      doc_kind: docKind,
      prefix: SANDBOX_RANGE_PREFIX[docKind],
      range_from: SANDBOX_RANGE_FROM,
      range_to: SANDBOX_RANGE_TO,
      current_number: SANDBOX_RANGE_FROM - 1,
      is_active: true,
      is_sandbox: true,
    })
    .select('*')
    .single();
  if (error) throw new Error(`No se pudo crear el rango sandbox: ${error.message}`);
  return data as NumberingRangeRow;
}

/**
 * ¿El rango avanzó respecto de `numeroAntes`? O sea: ¿la RPC de numeración alcanzó a commitear?
 *
 * Existe porque un fallo de red y un "rango agotado" llegan a `postgrest-js` de la misma forma —los
 * dos como `error`— y la diferencia decide si se puede deshacer la emisión o no. Preguntarle a la
 * base es determinístico; parsear el mensaje de error, no.
 *
 * Si esta consulta TAMBIÉN falla, devuelve `true`: ante la duda se asume que el número se consumió.
 * Es el lado seguro — deja una factura que hay que revisar a mano, en vez de un salto silencioso en
 * la numeración fiscal.
 */
async function elRangoAvanzo(
  supabase: SupabaseClient,
  rangeId: string,
  numeroAntes: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('numbering_ranges')
    .select('current_number')
    .eq('id', rangeId)
    .maybeSingle<{ current_number: number }>();
  if (error || !data) return true;
  return data.current_number > numeroAntes;
}

// ─── Emisión ─────────────────────────────────────────────────────────────────

/** Medio de pago DIAN (codelist 19.42) por método interno. */
const DIAN_PAYMENT_METHOD_CODES: Partial<Record<PaymentMethod, string>> = {
  EFECTIVO: '10',
  TRANSFERENCIA: '47',
  TARJETA: '48',
};

export interface IssueRequest {
  invoiceId: string;
  /**
   * La emisión declara la realidad del pago (reemplaza al binario
   * IMMEDIATE/CREDIT de la UI). PAGADO_AHORA registra el pago completo en la
   * misma emisión; ABONO_PARCIAL registra el abono y deja saldo con
   * vencimiento; PENDIENTE emite a crédito sin pago.
   */
  outcome: PaymentOutcome;
  /** Método del pago declarado (requerido en PAGADO_AHORA / ABONO_PARCIAL). */
  method?: PaymentMethod;
  /** Monto del abono en centavos (solo ABONO_PARCIAL: 0 < monto < total). */
  amountCents?: number;
  reference?: string | null;
  /** YYYY-MM-DD. Si falta en PENDIENTE/ABONO se usa el término por defecto de la clínica. */
  dueDate?: string | null;
  /** Seguimiento automático del saldo (default true; solo aplica si queda saldo). */
  followupEnabled?: boolean;
  wantsElectronicDelivery?: boolean;
  /** Autoría (profiles.id) del usuario que emite; null = sistema. */
  createdBy?: string | null;
}

export interface IssueResult {
  invoiceId: string;
  fullNumber: string;
  fiscalStatus: 'VALIDADA' | 'RECHAZADA' | 'PENDIENTE_VALIDACION';
  cufe: string | null;
  warnings: ValidationIssue[];
  posThreshold: PosThresholdCheck | null;
  providerMessage: string;
  /** Resultado de recaudo al cierre de la emisión. */
  dueDate: string;
  paidNowCents: number;
  balanceCents: number;
  collectionStatus: string;
  followupStatus: FollowupStatus;
}

export async function issueInvoice(
  supabase: SupabaseClient,
  clinicId: string,
  req: IssueRequest,
  now = new Date(),
): Promise<IssueResult> {
  const detail = await getInvoiceDetail(supabase, clinicId, req.invoiceId);
  if (!detail) throw new Error('Factura no encontrada');
  const { invoice, lines, payer } = detail;

  if (invoice.status !== 'BORRADOR' || invoice.number !== null) {
    throw new Error('Solo un borrador puede emitirse');
  }
  if (!payer) throw new Error('El borrador no tiene responsable de pago');

  // ── Validar el resultado de pago declarado ─────────────────────────────────
  const paymentTerms: PaymentTerms = req.outcome === 'PAGADO_AHORA' ? 'IMMEDIATE' : 'CREDIT';
  const paidNowCents =
    req.outcome === 'PAGADO_AHORA'
      ? invoice.total_cents
      : req.outcome === 'ABONO_PARCIAL'
        ? (req.amountCents ?? 0)
        : 0;
  if (req.outcome !== 'PENDIENTE') {
    if (req.method !== 'EFECTIVO' && req.method !== 'TRANSFERENCIA') {
      throw new Error(
        'El pago declarado en la emisión requiere método EFECTIVO o TRANSFERENCIA',
      );
    }
  }
  if (req.outcome === 'ABONO_PARCIAL') {
    if (
      !Number.isInteger(paidNowCents) ||
      paidNowCents <= 0 ||
      paidNowCents >= invoice.total_cents
    ) {
      throw new Error('El abono debe ser mayor que cero y menor que el total de la factura');
    }
  }

  const settings = await getBillingSettings(supabase, clinicId);
  if (!settings || settings.module_status !== 'ACTIVO') {
    throw new Error('El módulo de facturación no está activo. Configúralo primero.');
  }

  // Revalidación con inventario FRESCO (un blocker detiene la emisión).
  const itemIds = lines.map((l) => l.catalog_item_id).filter((x): x is string => !!x);
  const [items, stockMap, nearExpiry] = await Promise.all([
    getCatalogItems(supabase, clinicId, itemIds),
    getStockMap(supabase, clinicId, itemIds),
    getNearExpirySet(supabase, clinicId, itemIds, now),
  ]);
  const lineInputs: LineInput[] = lines.map((l) => {
    const item = l.catalog_item_id ? items.get(l.catalog_item_id) : undefined;
    return {
      catalogItemId: l.catalog_item_id,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      unitPriceCents: l.unit_price_cents,
      taxRate: l.tax_rate,
      discountCents: l.discount_cents,
      costCents: item?.cost_cents ?? undefined,
      trackStock: item?.track_stock ?? false,
      stock: l.catalog_item_id ? (stockMap.get(l.catalog_item_id) ?? 0) : undefined,
      nearExpiry: l.catalog_item_id ? nearExpiry.has(l.catalog_item_id) : false,
    };
  });
  const validation = validateDraftInvoice({
    lines: lineInputs,
    buyer: {
      fullName: payer.name,
      docType: payer.doc_type,
      docNumber: payer.doc_number,
      email: payer.email,
    },
    wantsElectronicDelivery: req.wantsElectronicDelivery ?? false,
    role: 'ADMIN',
    blockOnInsufficientStock: settings.block_on_insufficient_stock,
  });
  if (validation.blockers.length > 0) {
    throw new Error(
      `No se puede emitir: ${validation.blockers.map((b) => b.message).join(' | ')}`,
    );
  }

  const posThreshold =
    invoice.doc_kind === 'POS'
      ? checkPosThreshold(
          invoice.subtotal_cents - invoice.discount_cents,
          settings.uvt_value_cents,
        )
      : null;

  // El rango va ANTES del claim, y ese orden es el arreglo.
  //
  // `ensureActiveRange` puede fallar —su INSERT choca contra `numbering_ranges_active_uniq` si dos
  // emisiones concurrentes de una clínica sin rango— y corría DESPUÉS de pasar la factura a
  // EMITIENDO. Como el único rollback que existía era el del error de numeración, esa excepción
  // dejaba la factura en EMITIENDO PARA SIEMPRE: `issueInvoice` la rechaza por no estar en BORRADOR,
  // `discardDraft` también, y `InvoiceActionsPanel` no le pinta ningún botón. Ni se emite ni se
  // descarta. Corriendo antes, si falla la factura ni siquiera entró a ese estado.
  const range = await ensureActiveRange(supabase, clinicId, invoice.doc_kind, req.createdBy);
  const numeroAntes = range.current_number;

  // Guarda optimista: solo UN caller pasa el borrador a EMITIENDO.
  const { data: claimed, error: claimErr } = await supabase
    .from('invoices')
    .update({ status: 'EMITIENDO' })
    .eq('id', invoice.id)
    .eq('clinic_id', clinicId)
    .eq('status', 'BORRADOR')
    .select('id');
  if (claimErr) throw new Error(`No se pudo iniciar la emisión: ${claimErr.message}`);
  if (!claimed || claimed.length === 0) {
    throw new Error('La factura ya está en emisión o fue emitida');
  }

  // Consecutivo: atómico y NUNCA reutilizado (aunque algo falle después).
  const { data: numberData, error: numErr } = await supabase.rpc(
    'facturacion_assign_next_number',
    { p_range_id: range.id },
  );
  if (numErr) {
    // NO se deshace a ciegas. postgrest-js devuelve los fallos de RED en `error`, igual que un
    // "rango agotado": desde acá los dos se ven idénticos. Si la RPC alcanzó a hacer COMMIT y sólo
    // se perdió la respuesta, volver a BORRADOR hace que el vet reintente y queme un SEGUNDO número
    // — y el primero queda como un salto permanente en la numeración, que en Colombia es un problema
    // fiscal, no cosmético.
    //
    // Así que se pregunta a la base qué pasó de verdad, en vez de adivinar por el mensaje.
    const consumido = await elRangoAvanzo(supabase, range.id, numeroAntes);
    if (consumido) {
      console.error(
        `[facturacion] la factura ${invoice.id} consumió un consecutivo del rango ${range.id} y no se pudo confirmar. Queda en EMITIENDO a propósito: revisar antes de reintentar.`,
        numErr,
      );
      throw new Error(
        'El consecutivo se asignó pero no se pudo confirmar la emisión. No reintentes: avisá al equipo para no saltar un número de la numeración.',
      );
    }
    await supabase
      .from('invoices')
      .update({ status: 'BORRADOR' })
      .eq('id', invoice.id)
      .eq('clinic_id', clinicId)
      .eq('status', 'EMITIENDO');
    throw new Error(`No se pudo asignar el consecutivo: ${numErr.message}`);
  }
  const number = Number(numberData);
  const fullNumber = range.prefix ? `${range.prefix}-${number}` : String(number);

  // Vencimiento: pagado ahora vence al FINAL del día (no nace "vencida");
  // pendiente/abono usan la fecha dada o el término por defecto de la clínica.
  // Las fechas de vencimiento son días de BOGOTÁ (UTC-5 fijo), no del proceso: en Vercel (UTC)
  // una emisión después de las 19:00 de Bogotá caía en el día siguiente y el vencimiento nacía
  // corrido un día. Mismo criterio que defaultDueDate en la UI.
  const bogotaNow = new Date(now.getTime() - 5 * 3_600_000);
  let dueDate: string;
  if (paymentTerms === 'IMMEDIATE') {
    dueDate = bogotaNow.toISOString().slice(0, 10); // vence el mismo día (de Bogotá)
  } else if (req.dueDate) {
    dueDate = req.dueDate;
  } else {
    const d = new Date(bogotaNow);
    d.setUTCDate(d.getUTCDate() + (settings.default_payment_terms_days ?? 15));
    dueDate = d.toISOString().slice(0, 10);
  }

  // Respeta la configuración de la clínica: con los recordatorios apagados a nivel clínica, la
  // factura NO puede quedar marcada para seguimiento — la UI muestra el toggle deshabilitado y en
  // off, pero el estado del plan seguía mandando true y la factura quedaba con followup_enabled y
  // su badge, contradiciendo lo que el vet vio (el barrido igual no enviaba: run-all filtra por
  // reminders_enabled — el daño era el estado persistido inconsistente, no un envío indebido).
  const followupEnabled =
    paymentTerms === 'CREDIT' && (settings.reminders_enabled ?? false)
      ? (req.followupEnabled ?? true)
      : false;
  const { error: updErr } = await supabase
    .from('invoices')
    .update({
      status: 'EMITIDA',
      numbering_range_id: range.id,
      number,
      full_number: fullNumber,
      issued_at: now.toISOString(),
      due_date: dueDate,
      payment_terms: paymentTerms,
      followup_enabled: followupEnabled,
      followup_channel: followupEnabled ? settings.reminder_channel : null,
    })
    .eq('id', invoice.id)
    .eq('clinic_id', clinicId);
  if (updErr) {
    // Acá el consecutivo YA está consumido. Volver a BORRADOR sería lo peor que se puede hacer: el
    // vet reintenta, quema otro número, y el primero queda como salto permanente. Se reintenta el
    // update una vez —el caso típico es un corte de red, no un dato inválido— y si tampoco, se deja
    // el número escrito para que la factura sea recuperable en vez de perdida.
    const { error: reintentoErr } = await supabase
      .from('invoices')
      .update({ numbering_range_id: range.id, number, full_number: fullNumber })
      .eq('id', invoice.id)
      .eq('clinic_id', clinicId);
    console.error(
      `[facturacion] la factura ${invoice.id} tomó el consecutivo ${fullNumber} y no se pudo marcar EMITIDA. Queda en EMITIENDO con su número escrito: se completa a mano, NO se reemite.`,
      updErr,
      reintentoErr ?? '',
    );
    throw new Error(
      `La factura tomó el número ${fullNumber} pero no se pudo cerrar la emisión. No la reemitas: avisá al equipo para completarla sin saltar el consecutivo.`,
    );
  }
  await appendEvent(supabase, invoice.id, 'ISSUED', { number, fullNumber });

  // ── Registrar el pago declarado (Pagado ahora / Abono parcial) ─────────────
  //
  // VA ACÁ, PEGADO A LA EMISIÓN, Y NO AL FINAL. Estaba después del inventario, de las recetas y del
  // documento fiscal — tres escrituras que lanzan si fallan. Cualquiera de las tres dejaba la
  // factura EMITIDA, con su consecutivo fiscal quemado, y **la plata que el cliente ya entregó sin
  // registrar en ningún lado**.
  //
  // Lo que eso provocaba, verificado extremo a extremo: el borrador nace con
  // `balance_cents = total` (ver `createDraftInvoice`), `refreshInvoiceStatus` —que lo corregiría—
  // también quedaba después del throw, y `cartera/scheduler.ts` levanta las facturas con
  // `status='EMITIDA' AND followup_enabled AND balance_cents > 0`. O sea que en un ABONO PARCIAL el
  // motor de cobranza le escribía al cliente por el TOTAL, habiendo pagado una parte en efectivo.
  //
  // Y ninguno de los tres mensajes de error mencionaba el pago: el vet leía "no se pudo descontar
  // inventario" y no tenía cómo saber que lo otro había quedado sin anotar.
  //
  // EL CRITERIO: el pago es un hecho que YA OCURRIÓ EN EL MUNDO REAL — el cliente puso la plata
  // sobre el mostrador. Registrarlo no puede depender de que el inventario cuadre ni de que el
  // proveedor fiscal responda. El orden correcto es el orden de irreversibilidad: primero lo que ya
  // pasó afuera, después lo que podemos reintentar.
  //
  // Si ESTE insert falla, se lanza igual que antes — pero ahora es el paso que falló y no un daño
  // colateral de otro, así que el mensaje dice la verdad.
  if (paidNowCents > 0) {
    await insertPaymentWithApplication(
      supabase,
      clinicId,
      {
        invoiceId: invoice.id,
        invoiceTotalCents: invoice.total_cents,
        alreadyPaidCents: 0,
        creditedCents: 0,
        method: req.method!,
        amountCents: paidNowCents,
        reference: req.reference ?? null,
        note:
          req.outcome === 'ABONO_PARCIAL'
            ? 'Abono declarado en la emisión'
            : 'Pago declarado en la emisión',
        createdBy: req.createdBy ?? null,
      },
      now,
    );
  }

  // Inventario: descuento al emitir (decisión de producto heredada de Vetnia).
  if (settings.inventory_decrement_on === 'INVOICE_ISSUE') {
    const movements = lines
      .filter((l) => l.catalog_item_id && items.get(l.catalog_item_id)?.track_stock)
      .map((l) => {
        const movement = { qty: saleMovementQty(l.qty), type: 'SALIDA_VENTA' as const };
        validateMovementSign(movement);
        return {
          clinic_id: clinicId,
          created_by: req.createdBy ?? null,
          item_id: l.catalog_item_id!,
          qty: movement.qty,
          movement_type: movement.type,
          ref_type: 'INVOICE' as const,
          ref_id: invoice.id,
          note: `Factura ${fullNumber}`,
        };
      });
    if (movements.length > 0) {
      const { error: movErr } = await supabase.from('inventory_movements').insert(movements);
      if (movErr) throw new Error(`No se pudo descontar inventario: ${movErr.message}`);
    }

    // Recetas de consumo: cada SERVICIO facturado descuenta también los
    // componentes de su receta (SALIDA_APLICACION), cantidad × unidades del
    // servicio, solo para componentes con control de stock.
    const serviceLines = lines.filter(
      (l) => l.catalog_item_id && items.get(l.catalog_item_id)?.item_type === 'SERVICIO',
    );
    if (serviceLines.length > 0) {
      const serviceIds = [...new Set(serviceLines.map((l) => l.catalog_item_id!))];
      const recipes = await getRecipesForServices(supabase, clinicId, serviceIds);
      const componentIds = [...new Set([...recipes.values()].flat().map((c) => c.component_id))];
      const componentItems = await getCatalogItems(supabase, clinicId, componentIds);
      const consumption = computeRecipeConsumption(
        serviceLines.map((l) => ({ serviceId: l.catalog_item_id!, qty: l.qty })),
        recipes,
        (id) => !!componentItems.get(id)?.track_stock,
      );
      const recipeMovements = consumption.map((c) => {
        const movement = { qty: saleMovementQty(c.useQty), type: 'SALIDA_APLICACION' as const };
        validateMovementSign(movement);
        return {
          clinic_id: clinicId,
          created_by: req.createdBy ?? null,
          item_id: c.componentId,
          qty: movement.qty,
          movement_type: movement.type,
          ref_type: 'INVOICE' as const,
          ref_id: invoice.id,
          note: `Receta de servicio · ${fullNumber}`,
        };
      });
      if (recipeMovements.length > 0) {
        const { error: recErr } = await supabase.from('inventory_movements').insert(recipeMovements);
        if (recErr) throw new Error(`No se pudieron descontar componentes de receta: ${recErr.message}`);
      }
    }
  }

  // Proveedor fiscal (sandbox en v1; real en 1f detrás de la misma interfaz).
  const provider = await getFiscalProvider(supabase, clinicId);
  const submission: FiscalSubmission = {
    docKind: invoice.doc_kind,
    fullNumber,
    issuedAt: now.toISOString(),
    emitter: {
      name: settings.fiscal_name ?? 'Emisor sin configurar',
      idType: settings.fiscal_id_type ?? 'CC',
      idNumber: settings.fiscal_id_number ?? '',
      regime: settings.fiscal_regime,
      address: settings.fiscal_address,
      municipalityCode: settings.municipality_code,
    },
    buyer: {
      fullName: payer.name,
      docType: payer.doc_type,
      docNumber: payer.doc_number,
      email: payer.email,
    },
    numbering: {
      prefix: range.prefix,
      number,
      fullNumber,
      resolutionNumber: range.resolution_number,
      resolutionDate: range.resolution_date,
      validFrom: range.valid_from,
      validUntil: range.valid_until,
      technicalKey: range.technical_key,
      isSandbox: range.is_sandbox,
    },
    // Forma de pago DIAN: contado/crédito + vencimiento. Hecho fiscal, no
    // estado de recaudo (§2 spec).
    payment: {
      means: paymentTerms === 'IMMEDIATE' ? 'CONTADO' : 'CREDITO',
      dueDate: paymentTerms === 'IMMEDIATE' ? null : dueDate,
      methodCode: req.method ? (DIAN_PAYMENT_METHOD_CODES[req.method] ?? null) : null,
    },
    subtotalCents: invoice.subtotal_cents,
    taxCents: invoice.tax_cents,
    totalCents: invoice.total_cents,
    lines: lines.map((l) => ({
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      unitPriceCents: l.unit_price_cents,
      taxRate: l.tax_rate,
      taxStatus: l.tax_status,
      taxCents: l.tax_cents,
      totalCents: l.total_cents,
    })),
  };

  await appendEvent(supabase, invoice.id, 'FISCAL_SUBMITTED', { provider: provider.name });

  let fiscalResult: FiscalResult | null = null;
  let providerError: string | null = null;
  try {
    fiscalResult = await provider.submitInvoice(submission);
  } catch (e) {
    providerError = e instanceof Error ? e.message : String(e);
  }

  const { error: fdErr } = await supabase.from('fiscal_documents').insert({
    clinic_id: clinicId,
    created_by: req.createdBy ?? null,
    invoice_id: invoice.id,
    provider: provider.name,
    doc_kind: invoice.doc_kind,
    status: fiscalResult ? fiscalResult.status : 'PENDIENTE',
    cufe: fiscalResult?.cufe ?? null,
    request_payload: submission as unknown as Record<string, unknown>,
    response_payload: fiscalResult
      ? ({ message: fiscalResult.providerMessage, providerRef: fiscalResult.providerRef } as Record<
          string,
          unknown
        >)
      : { error: providerError },
    attempts: 1,
    last_error: providerError,
    submitted_at: now.toISOString(),
    accepted_at: fiscalResult?.accepted ? now.toISOString() : null,
  });
  if (fdErr) throw new Error(`No se pudo registrar el documento fiscal: ${fdErr.message}`);

  if (fiscalResult) {
    await appendEvent(
      supabase,
      invoice.id,
      fiscalResult.accepted ? 'FISCAL_VALIDATED' : 'FISCAL_REJECTED',
      { cufe: fiscalResult.cufe, message: fiscalResult.providerMessage },
    );
  }
  // Sin resultado (proveedor caído): queda PENDIENTE_VALIDACION vía el evento
  // FISCAL_SUBMITTED; el cron de reintentos (1f) retomará el documento.

  // El pago YA se registró, arriba, pegado a la emisión — ver el comentario largo de allá.
  //
  // El `refreshInvoiceStatus` sí se queda al final: es un recálculo de cachés derivados y es
  // idempotente, así que si algo lanzó antes, la siguiente lectura de la factura lo recompone. No
  // tiene la propiedad que sí tenía el pago, que era la de perderse para siempre.
  const derived = await refreshInvoiceStatus(supabase, clinicId, invoice.id, now);

  // (La agenda de recordatorios local fue reemplazada por el motor de cartera:
  // el scheduler del cron programa el seguimiento a partir de los eventos de la
  // factura — acá ya no se inserta nada.)

  return {
    invoiceId: invoice.id,
    fullNumber,
    fiscalStatus: derived.fiscal as IssueResult['fiscalStatus'],
    cufe: fiscalResult?.cufe ?? null,
    warnings: validation.warnings,
    posThreshold,
    providerMessage: fiscalResult?.providerMessage ?? `Proveedor no disponible: ${providerError}`,
    dueDate,
    paidNowCents,
    balanceCents: derived.balanceCents,
    collectionStatus: derived.collection,
    followupStatus: derived.followup,
  };
}

/**
 * Marca la factura como ENVIADA al cliente (evento SENT + refresh de cachés).
 * Lo llama quien haga el envío efectivo (WhatsApp del motor, botón de la UI…).
 */
export async function markInvoiceSent(
  supabase: SupabaseClient,
  clinicId: string,
  invoiceId: string,
  payload: { channel: 'EMAIL' | 'WHATSAPP'; to: string },
): Promise<void> {
  await appendEvent(supabase, invoiceId, 'SENT', payload);
  await refreshInvoiceStatus(supabase, clinicId, invoiceId);
}

/**
 * Marca que el envío al cliente NO salió.
 *
 * Existe porque el fallo no se registraba en ningún lado: `facturacion/email.ts` devolvía el error a
 * la UI y ahí moría — ni una fila, ni un `console.error`. Un correo que no sale es indistinguible de
 * uno que salió y el cliente no leyó, y esa diferencia decide si hay que reenviar o llamar por
 * teléfono.
 *
 * `DELIVERY_FAILED` ya existía en el CHECK de `invoice_events` y el reductor ya lo traduce a
 * `delivery = 'FALLIDA'` (`domain/invoice-status.ts:124`, con tests), y el detalle lo pinta como
 * "Falló la entrega". O sea que esto no agrega concepto: usa el que ya estaba y nadie emitía.
 *
 * NUNCA lanza: el llamador está en su camino de error y una excepción acá enmascararía la causa
 * original, que es la que el vet necesita ver.
 */
export async function markInvoiceDeliveryFailed(
  supabase: SupabaseClient,
  clinicId: string,
  invoiceId: string,
  payload: { channel: 'EMAIL' | 'WHATSAPP'; to: string; error: string },
): Promise<void> {
  try {
    await appendEvent(supabase, invoiceId, 'DELIVERY_FAILED', payload);
    await refreshInvoiceStatus(supabase, clinicId, invoiceId);
  } catch (e) {
    console.error(
      `[facturacion] envío fallido de ${invoiceId} y tampoco se pudo registrar:`,
      (e as Error).message,
    );
  }
}

// ─── Descartar borrador (lo ÚNICO que se puede "borrar") ─────────────────────

export async function discardDraft(
  supabase: SupabaseClient,
  clinicId: string,
  invoiceId: string,
): Promise<void> {
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('id, status, number')
    .eq('clinic_id', clinicId)
    .eq('id', invoiceId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la factura: ${error.message}`);
  if (!invoice) throw new Error('Factura no encontrada');
  if ((invoice as InvoiceRow).status !== 'BORRADOR' || (invoice as InvoiceRow).number !== null) {
    throw new Error(
      'Una factura emitida no se elimina: la anulación se hace mediante nota crédito ' +
        'y su consecutivo no se reutiliza (Concepto DIAN 106/2022).',
    );
  }
  // Eventos y líneas caen por ON DELETE CASCADE.
  const { error: delErr } = await supabase
    .from('invoices')
    .delete()
    .eq('id', invoiceId)
    .eq('clinic_id', clinicId)
    .eq('status', 'BORRADOR');
  if (delErr) throw new Error(`No se pudo descartar el borrador: ${delErr.message}`);
}

// ─── Pagos manuales (efectivo / transferencia) ───────────────────────────────

export interface ManualPaymentRequest {
  invoiceId: string;
  method: PaymentMethod;
  amountCents: number;
  reference?: string | null;
  note?: string | null;
  /** Autoría (profiles.id) del usuario que registra el pago; null = sistema. */
  createdBy?: string | null;
}

export async function registerManualPayment(
  supabase: SupabaseClient,
  clinicId: string,
  req: ManualPaymentRequest,
  now = new Date(),
) {
  const detail = await getInvoiceDetail(supabase, clinicId, req.invoiceId);
  if (!detail) throw new Error('Factura no encontrada');
  const { invoice } = detail;
  if (invoice.status !== 'EMITIDA') {
    throw new Error('Solo una factura emitida puede recibir pagos');
  }

  const application = await insertPaymentWithApplication(
    supabase,
    clinicId,
    {
      invoiceId: invoice.id,
      invoiceTotalCents: invoice.total_cents,
      alreadyPaidCents: invoice.paid_cents,
      creditedCents: invoice.credited_cents,
      method: req.method,
      amountCents: req.amountCents,
      reference: req.reference ?? null,
      note: req.note ?? null,
      createdBy: req.createdBy ?? null,
    },
    now,
  );
  const derived = await refreshInvoiceStatus(supabase, clinicId, invoice.id, now);

  // Pago total → el seguimiento se detiene solo (Ley 2300 §detención): el
  // motor de cartera deriva followupStatus de los eventos y deja de programar.
  return { ...application, collectionStatus: derived.collection, followupStatus: derived.followup };
}

// ─── Pausar / reanudar recordatorios por factura ─────────────────────────────

export async function setInvoiceRemindersPaused(
  supabase: SupabaseClient,
  clinicId: string,
  invoiceId: string,
  paused: boolean,
): Promise<void> {
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('id, status')
    .eq('clinic_id', clinicId)
    .eq('id', invoiceId)
    .maybeSingle();
  if (error || !invoice) throw new Error('Factura no encontrada');
  await appendEvent(supabase, invoiceId, paused ? 'REMINDERS_PAUSED' : 'REMINDERS_RESUMED');
  await refreshInvoiceStatus(supabase, clinicId, invoiceId);
}
