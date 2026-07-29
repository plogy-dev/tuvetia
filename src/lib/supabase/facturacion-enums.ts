// Uniones de valores para los campos text+CHECK del schema Supabase de
// facturación. Toda validación de estos valores pasa por aquí.
// Fuente actualizada por el bloque recaudo/cartera F1-F5 (David).
//
// Vive en la capa base (lib/supabase) porque describe el SCHEMA y tanto
// types.ts como el dominio de facturación lo necesitan;
// lib/facturacion/domain/types.ts re-exporta todo (consumidores intactos).

// Portado del MVP Vetnia (docs/referencia/facturacion-vetnia/).

/** Tipo de documento fiscal DIAN: factura electrónica de venta o documento equivalente POS electrónico. */
export const DOC_KINDS = ["FACTURA_VENTA", "POS"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/**
 * Condición de IVA del ítem. EXCLUIDO ≠ EXENTO: el excluido no genera IVA ni
 * descontables; el exento es gravado a tarifa 0%. La tarifa numérica (TaxRate)
 * solo aplica cuando la condición es GRAVADO o EXENTO (0).
 */
export const TAX_STATUSES = ["GRAVADO", "EXENTO", "EXCLUIDO"] as const;
export type TaxStatus = (typeof TAX_STATUSES)[number];

export const FISCAL_STATUSES = [
  "BORRADOR",
  "PENDIENTE_VALIDACION",
  "RECHAZADA",
  "VALIDADA",
  "AFECTADA_POR_NOTA_CREDITO",
] as const;
export type FiscalStatus = (typeof FISCAL_STATUSES)[number];

export const COLLECTION_STATUSES = [
  "PENDIENTE",
  "PARCIALMENTE_PAGADA",
  "PAGADA",
  "VENCIDA",
  "EN_DISPUTA",
  "EN_PROMESA_DE_PAGO",
  "CASTIGADA",
] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export const DELIVERY_STATUSES = [
  "NO_ENVIADA",
  "EN_COLA",
  "ENVIADA",
  "ENTREGADA",
  "FALLIDA",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * 4ª dimensión (F1 del plan de recaudo): estado del SEGUIMIENTO de cartera.
 * Derivado, nunca editado a mano — ver deriveFollowupStatus().
 */
export const FOLLOWUP_STATUSES = [
  "NO_REQUERIDO",
  "PROGRAMADO",
  "ACTIVO",
  "PAUSADO",
  "COMPLETADO",
  "CANCELADO",
  "REQUIERE_ATENCION_HUMANA",
] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

/** Resultado de pago declarado por el vet al emitir (reemplaza al binario IMMEDIATE/CREDIT en la UI). */
export const PAYMENT_OUTCOMES = ["PAGADO_AHORA", "PENDIENTE", "ABONO_PARCIAL"] as const;
export type PaymentOutcome = (typeof PAYMENT_OUTCOMES)[number];

export const INVOICE_EVENT_TYPES = [
  "CREATED",
  "ISSUED",
  "FISCAL_SUBMITTED",
  "FISCAL_VALIDATED",
  "FISCAL_REJECTED",
  "QUEUED",
  "SENT",
  "DELIVERED",
  "DELIVERY_FAILED",
  "PAYMENT_APPLIED",
  "DISPUTE_OPENED",
  "DISPUTE_CLOSED",
  "CREDIT_NOTE_APPLIED",
  "WRITTEN_OFF",
  "REMINDERS_PAUSED",
  "REMINDERS_RESUMED",
  "PROMISE_TO_PAY",
  // F2 · motor de cartera
  "REMINDER_SENT",
  "PROMISE_EXPIRED",
  "HUMAN_TASK_OPENED",
  "HUMAN_TASK_RESOLVED",
  "CHANNEL_REVOKED",
] as const;
export type InvoiceEventType = (typeof INVOICE_EVENT_TYPES)[number];

export interface InvoiceEventLike {
  type: InvoiceEventType;
  createdAt: Date;
  payload?: unknown;
}

export const MOVEMENT_TYPES = [
  "CARGA_INICIAL",
  "ENTRADA_COMPRA",
  "SALIDA_VENTA",
  "SALIDA_APLICACION",
  "CONSUMO_INTERNO",
  "DEVOLUCION",
  "VENCIMIENTO",
  "PERDIDA",
  "AJUSTE",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const CATALOG_KINDS = ["SERVICIO", "PRODUCTO", "MEDICAMENTO", "INSUMO"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export const ROLES = ["ADMIN", "VETERINARIO", "RECEPCION", "CONTADOR"] as const;
export type Role = (typeof ROLES)[number];

export const TAX_RATES = [0, 5, 19] as const;
export type TaxRate = (typeof TAX_RATES)[number];

export const REMINDER_STEP_KINDS = [
  "ENVIO_FACTURA",
  "RECORDATORIO_1",
  "RECORDATORIO_2",
  "AVISO_SALDO",
  "ESCALAMIENTO",
] as const;
export type ReminderStepKind = (typeof REMINDER_STEP_KINDS)[number];

export const CHANNELS = ["WHATSAPP", "EMAIL"] as const;
export type Channel = (typeof CHANNELS)[number];

// Espejo EXACTO del CHECK real de payments.method en la BD
// (0034_facturacion_cartera, que consolida el recaudo del repo origen):
// medios colombianos del día a día del vet + ENLACE reservado a la pasarela.
export const PAYMENT_METHODS = [
  "EFECTIVO",
  "TRANSFERENCIA",
  "NEQUI",
  "DAVIPLATA",
  "TARJETA",
  "ENLACE",
  "OTRO",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Métodos que el vet registra a mano (todos menos el enlace de pasarela). */
export const MANUAL_PAYMENT_METHODS = [
  "EFECTIVO",
  "TRANSFERENCIA",
  "NEQUI",
  "DAVIPLATA",
  "TARJETA",
  "OTRO",
] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];
