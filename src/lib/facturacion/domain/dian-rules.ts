// Reglas fiscales colombianas relevantes para el MVP:
// 1) Datos mínimos del comprador (Comunicado DIAN 026-2025): nombre/razón social,
//    tipo y número de identificación, y correo SOLO si desea el documento digital.
//    NO se puede exigir dirección, teléfono ni RUT físico para emitir.
// 2) Una factura VALIDADA no se elimina ni se anula con un botón: se afecta
//    mediante NOTA CRÉDITO y su consecutivo jamás se reutiliza.

import type { FiscalStatus } from "./types";

export interface BuyerData {
  fullName?: string | null;
  docType?: string | null;
  docNumber?: string | null;
  email?: string | null;
}

export interface BuyerValidation {
  valid: boolean;
  missing: string[];
}

export function validateBuyerData(
  buyer: BuyerData,
  opts: { wantsElectronicDelivery: boolean },
): BuyerValidation {
  const missing: string[] = [];
  if (!buyer.fullName?.trim()) missing.push("nombre o razón social");
  if (!buyer.docType?.trim()) missing.push("tipo de identificación");
  if (!buyer.docNumber?.trim()) missing.push("número de identificación");
  if (opts.wantsElectronicDelivery && !buyer.email?.trim()) {
    missing.push("correo electrónico (para entrega digital)");
  }
  return { valid: missing.length === 0, missing };
}

/**
 * Campos que la DIAN prohíbe EXIGIR para emitir. Existe un test que garantiza
 * que validateBuyerData nunca los reporta como faltantes.
 */
export const FIELDS_NEVER_REQUIRED = ["dirección", "teléfono", "RUT físico"] as const;

/** Solo un borrador (o algo aún no validado) puede descartarse. */
export function canDiscardInvoice(fiscal: FiscalStatus): boolean {
  return fiscal === "BORRADOR";
}

/** La anulación de una factura validada exige nota crédito. */
export function annulmentRequiresCreditNote(fiscal: FiscalStatus): boolean {
  return fiscal === "VALIDADA" || fiscal === "AFECTADA_POR_NOTA_CREDITO";
}

/**
 * La falta de pago NO es causal de anulación cuando el servicio se prestó
 * (Concepto DIAN 106/2022). El servidor consulta esta regla antes de permitir
 * crear una nota crédito.
 */
export function isValidCreditNoteReason(reason: string): boolean {
  const normalized = reason.trim().toLowerCase();
  if (!normalized) return false;
  const invalid = ["no pago", "no pagó", "falta de pago", "impago", "no pagaron"];
  return !invalid.some((r) => normalized.includes(r));
}

// ---------- Regla de las 5 UVT (art. 616-1 ET, Ley 2155/2021) ----------

export const POS_THRESHOLD_UVT = 5;

export interface PosThresholdCheck {
  exceeds: boolean;
  thresholdCents: number;
  message?: string;
}

/**
 * Una operación que supera 5 UVT (antes de impuestos) debe soportarse con
 * factura electrónica de venta si el adquirente la exige; emitir POS por encima
 * arriesga sanción de clausura. Es un WARNING de producto (la venta puede seguir
 * siendo legal por POS si el cliente no exige factura), nunca un blocker.
 */
export function checkPosThreshold(
  preTaxTotalCents: number,
  uvtValueCents: number,
): PosThresholdCheck {
  if (uvtValueCents <= 0) throw new Error("uvtValueCents debe ser positivo");
  const thresholdCents = POS_THRESHOLD_UVT * uvtValueCents;
  if (preTaxTotalCents <= thresholdCents) return { exceeds: false, thresholdCents };
  return {
    exceeds: true,
    thresholdCents,
    message:
      `La operación supera ${POS_THRESHOLD_UVT} UVT: si el cliente lo exige, ` +
      "debe emitirse factura electrónica de venta en lugar de tiquete POS.",
  };
}
