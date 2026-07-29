// Constantes del módulo de facturación.

import type { DocKind } from '@/lib/facturacion/domain/types';

/**
 * Valor del UVT en CENTAVOS por año (la DIAN lo fija cada diciembre).
 * 2026: $52.374 → Res. 000238 del 15-dic-2025. Al agregar un año nuevo,
 * actualizar también DEFAULT_UVT_YEAR y el default de billing_settings.
 */
export const UVT_VALUE_CENTS_BY_YEAR: Record<number, number> = {
  2025: 4980500,
  2026: 5237400,
};

export const DEFAULT_UVT_YEAR = 2026;
export const DEFAULT_UVT_VALUE_CENTS = UVT_VALUE_CENTS_BY_YEAR[DEFAULT_UVT_YEAR];

/** Tipos de documento del adquiriente aceptados por la DIAN (subset útil). */
export const PAYER_DOC_TYPES = ['CC', 'CE', 'NIT', 'PP', 'TI', 'PEP', 'NUIP'] as const;
export type PayerDocType = (typeof PAYER_DOC_TYPES)[number];

/**
 * "Consumidor final": identificación genérica que la DIAN acepta para ventas
 * de mostrador sin identificar al comprador (típico en POS).
 */
export const CONSUMIDOR_FINAL = {
  name: 'Consumidor final',
  docType: 'CC',
  docNumber: '222222222222',
} as const;

/** Etiquetas de las formas de pago (es-CO) para selects y timelines. */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia bancaria',
  NEQUI: 'Nequi',
  DAVIPLATA: 'Daviplata',
  TARJETA: 'Tarjeta (datáfono)',
  ENLACE: 'Enlace de pago',
  OTRO: 'Otro',
};

/** Prefijos de los rangos SANDBOX que se auto-crean por tipo de documento. */
export const SANDBOX_RANGE_PREFIX: Record<DocKind | 'NOTA_CREDITO' | 'NOTA_DEBITO', string> = {
  FACTURA_VENTA: 'SFV',
  POS: 'SPOS',
  NOTA_CREDITO: 'SNC',
  NOTA_DEBITO: 'SND',
};

export const SANDBOX_RANGE_FROM = 1;
export const SANDBOX_RANGE_TO = 9_999_999;
