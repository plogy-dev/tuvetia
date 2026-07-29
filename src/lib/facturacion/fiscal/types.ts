// Port fiscal del proveedor de facturación electrónica DIAN.
// El dominio y los casos de uso SOLO conocen esta interfaz; el proveedor real
// (MATIAS / Dataico / Factus — por decidir) se implementa como un adapter más
// sin tocar el resto del sistema. Ver docs/producto/facturacion-dian.md.
//
// Ampliado respecto al MVP Vetnia con lo que exige la emisión real:
// tipo de documento (factura de venta vs POS electrónico), datos del emisor,
// resolución de numeración, y respuesta con XML/PDF/referencia del proveedor.

import type { DocKind, TaxRate, TaxStatus } from '@/lib/facturacion/domain/types';

/** Adquiriente (datos mínimos DIAN, Comunicado 026-2025). */
export interface FiscalBuyer {
  fullName: string;
  docType: string;
  docNumber: string;
  email?: string | null;
}

/** Emisor: el vet, con sus datos fiscales de billing_settings. */
export interface FiscalEmitter {
  name: string;
  idType: string;
  idNumber: string;
  regime?: string | null;
  address?: string | null;
  municipalityCode?: string | null;
}

/** Rango de numeración DIAN con el que se emite este documento. */
export interface FiscalNumbering {
  prefix: string;
  number: number;
  fullNumber: string;
  resolutionNumber?: string | null;
  resolutionDate?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  technicalKey?: string | null;
  isSandbox: boolean;
}

export interface FiscalLine {
  description: string;
  qty: number;
  unit: string;
  unitPriceCents: number;
  taxRate: TaxRate;
  taxStatus: TaxStatus;
  taxCents: number;
  totalCents: number;
}

/**
 * Forma de pago DIAN (FormaDePago UBL): 1 = Contado, 2 = Crédito.
 * A crédito la DIAN exige la fecha de vencimiento (PaymentDueDate).
 * No confundir con el estado de RECAUDO: una factura de contado con pago
 * declarado y una a crédito pendiente son hechos fiscales distintos.
 */
export interface FiscalPaymentInfo {
  means: 'CONTADO' | 'CREDITO';
  /** YYYY-MM-DD; requerida cuando means = CREDITO. */
  dueDate: string | null;
  /** Medio de pago DIAN (codelist 19.42): 10 efectivo, 42 consignación, 47 transferencia… */
  methodCode?: string | null;
}

export interface FiscalSubmission {
  docKind: DocKind;
  fullNumber: string;
  issuedAt: string; // ISO
  emitter: FiscalEmitter;
  buyer: FiscalBuyer;
  numbering: FiscalNumbering;
  payment: FiscalPaymentInfo;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  lines: FiscalLine[];
}

export type FiscalSubmissionStatus = 'ACEPTADO' | 'RECHAZADO' | 'PENDIENTE';

export interface FiscalResult {
  accepted: boolean;
  status: FiscalSubmissionStatus;
  cufe: string | null;
  providerMessage: string;
  /** Identificador del documento en el proveedor (para consultas/reintentos). */
  providerRef?: string | null;
  /** XML UBL firmado (base64) si el proveedor lo devuelve inline. */
  xmlBase64?: string | null;
  /** URL del PDF del proveedor, si lo genera. */
  pdfUrl?: string | null;
}

export interface FiscalCreditNoteSubmission {
  fullNumber: string;
  invoiceFullNumber: string;
  invoiceCufe?: string | null;
  reason: string;
  totalCents: number;
  emitter: FiscalEmitter;
  buyer: FiscalBuyer;
}

export interface FiscalProvider {
  readonly name: string;
  submitInvoice(sub: FiscalSubmission): Promise<FiscalResult>;
  submitCreditNote(sub: FiscalCreditNoteSubmission): Promise<FiscalResult>;
}
