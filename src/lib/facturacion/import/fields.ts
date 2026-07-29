// Constantes y tipos del wizard de importación, SIN imports pesados.
// Separados de parse.ts a propósito: parse.ts importa xlsx + papaparse en
// top-level, y como ImportWizard (client component) necesitaba estas
// constantes, xlsx terminaba en el bundle del navegador (~110-150KB gzip)
// aunque el parseo ocurre 100% en el servidor. El cliente importa de acá;
// parse.ts re-exporta para no romper a sus consumidores server-side.

import type { TaxStatus } from '@/lib/facturacion/domain/types';

export const IMPORT_FIELDS = [
  'name',
  'category',
  'sku',
  'kind',
  'purchaseUnit',
  'useUnit',
  'conversionFactor',
  'initialQty',
  'costPesos',
  'pricePesos',
  'taxRate',
  'minStock',
  'lotNumber',
  'expiresAt',
  'supplier',
  'location',
  'durationMinutes',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/**
 * Preset del wizard: cambia la validación y el copy, no el pipeline.
 * 'servicios' fuerza kind=SERVICIO, ignora existencias y parsea duración.
 */
export type ImportPreset = 'productos' | 'servicios';

export const FIELD_LABELS: Record<ImportField, string> = {
  name: 'Nombre del producto',
  category: 'Categoría',
  sku: 'Código interno / SKU',
  kind: 'Tipo (producto, medicamento, insumo, servicio)',
  purchaseUnit: 'Unidad de compra',
  useUnit: 'Unidad de uso o venta',
  conversionFactor: 'Factor de conversión',
  initialQty: 'Existencia inicial',
  costPesos: 'Costo unitario',
  pricePesos: 'Precio de venta',
  taxRate: 'Impuesto (IVA %)',
  minStock: 'Stock mínimo',
  lotNumber: 'Número de lote',
  expiresAt: 'Fecha de vencimiento',
  supplier: 'Proveedor',
  location: 'Ubicación o bodega',
  durationMinutes: 'Duración (minutos)',
};

export type ImportMapping = Record<string, ImportField | ''>;

/** Máximo de filas por archivo (protege payloads jsonb y tiempos de action). */
export const MAX_IMPORT_ROWS = 1000;

export type RowStatus = 'OK' | 'AVISO' | 'DUPLICADO' | 'ERROR';

export interface ValidatedRow {
  index: number;
  status: RowStatus;
  messages: string[];
  parsed: {
    name: string;
    category: string | null;
    sku: string | null;
    kind: string;
    purchaseUnit: string;
    useUnit: string;
    conversionFactor: number;
    initialQty: number;
    costCents: number;
    priceCents: number;
    taxRate: number;
    taxStatus: TaxStatus;
    minStock: number;
    lotNumber: string | null;
    expiresAt: string | null;
    supplier: string | null;
    location: string | null;
    durationMinutes: number | null;
  } | null;
}

export interface ImportReport {
  total: number;
  ready: number;
  withWarnings: number;
  duplicates: number;
  errors: number;
}
