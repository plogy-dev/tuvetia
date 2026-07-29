// Filas propuestas por la IA (foto o texto pegado) convertidas a la MISMA
// tabla {columns, rows} que produce parseInventoryFile. Los encabezados están
// elegidos a propósito para que proposeMapping() los reconozca sin tocar
// parse.ts: la captura entra al mismo pipeline preview → validación → commit.
// Módulo PURO (sin xlsx/Supabase): testeable en unit tests y seguro para el
// bundle del cliente.

/** Máximo de filas que aceptamos de una captura IA (foto/texto). */
export const MAX_CAPTURE_ROWS = 300;

export interface CaptureRow {
  nombre: string | null;
  categoria: string | null;
  tipo: string | null;
  cantidad: string | null;
  costo: string | null;
  precio: string | null;
  iva: string | null;
  unidad: string | null;
  minimo: string | null;
  lote: string | null;
  vencimiento: string | null;
  proveedor: string | null;
  ubicacion: string | null;
  sku: string | null;
  duracion: string | null;
}

/** Encabezado visible por clave — cada uno matchea una regex de proposeMapping. */
export const CAPTURE_COLUMNS: Record<keyof CaptureRow, string> = {
  nombre: 'Nombre',
  categoria: 'Categoría',
  tipo: 'Tipo',
  cantidad: 'Existencia',
  costo: 'Costo',
  precio: 'Precio',
  iva: 'IVA',
  unidad: 'Unidad',
  minimo: 'Mínimo',
  lote: 'Lote',
  vencimiento: 'Vencimiento',
  proveedor: 'Proveedor',
  ubicacion: 'Ubicación',
  sku: 'SKU',
  duracion: 'Duración',
};

const CAPTURE_KEYS = Object.keys(CAPTURE_COLUMNS) as (keyof CaptureRow)[];

/**
 * Convierte las filas de la IA a la tabla del wizard. Solo incluye las
 * columnas con algún valor y descarta filas completamente vacías; la
 * validación por fila (nombre ausente, precio inválido…) la hace validateRows.
 */
export function captureRowsToTable(rows: CaptureRow[]): {
  columns: string[];
  rows: Record<string, string>[];
} {
  const clean = rows
    .map((r) => {
      const out: Partial<Record<keyof CaptureRow, string>> = {};
      for (const k of CAPTURE_KEYS) {
        const v = (r[k] ?? '').toString().trim();
        if (v) out[k] = v;
      }
      return out;
    })
    .filter((r) => Object.keys(r).length > 0);

  const usedKeys = CAPTURE_KEYS.filter((k) => clean.some((r) => r[k] !== undefined));
  return {
    columns: usedKeys.map((k) => CAPTURE_COLUMNS[k]),
    rows: clean.map((r) =>
      Object.fromEntries(usedKeys.map((k) => [CAPTURE_COLUMNS[k], r[k] ?? ''])),
    ),
  };
}
