import 'server-only';

// Transcripción con IA de una foto (o texto pegado) de una lista de productos
// o servicios a la tabla {columns, rows} del wizard de importación. Calco del
// patrón de recipe-ingest.ts: la IA SOLO PROPONE — el resultado entra al mismo
// preview con validación por fila y el vet confirma antes de tocar la base.
//
// Modelo: visionModel() de la fábrica de Athos (contrato §7) — la misma
// utilería se reutilizará para facturas de compra por imagen.

import { generateObject } from 'ai';
import { z } from 'zod';
import { visionModel } from '@/lib/athos-agent/model';
import { captureRowsToTable, MAX_CAPTURE_ROWS, type CaptureRow } from './capture';

const cell = z.string().nullable();
const CaptureRowSchema = z.object({
  nombre: cell.describe('Nombre del producto o servicio, tal como aparece.'),
  categoria: cell.describe('Categoría o grupo si aparece; si no, null.'),
  tipo: cell.describe('producto, medicamento, insumo o servicio — solo si se distingue; si no, null.'),
  cantidad: cell.describe('Existencia/cantidad TAL COMO APARECE escrita (texto); si no aparece, null.'),
  costo: cell.describe('Costo unitario tal como aparece (texto, con sus puntos/comas); si no, null.'),
  precio: cell.describe('Precio de venta tal como aparece (texto, con sus puntos/comas); si no, null.'),
  iva: cell.describe('IVA (%) si aparece; si no, null.'),
  unidad: cell.describe('Unidad de uso/venta (ml, tableta, unidad…) si aparece; si no, null.'),
  minimo: cell.describe('Stock mínimo si aparece; si no, null.'),
  lote: cell.describe('Número de lote si aparece; si no, null.'),
  vencimiento: cell.describe('Fecha de vencimiento si aparece; si no, null.'),
  proveedor: cell.describe('Proveedor o laboratorio si aparece; si no, null.'),
  ubicacion: cell.describe('Ubicación o bodega si aparece; si no, null.'),
  sku: cell.describe('Código interno / SKU si aparece; si no, null.'),
  duracion: cell.describe('Duración en minutos (solo servicios) si aparece; si no, null.'),
});

const TableSchema = z.object({
  rows: z.array(CaptureRowSchema).max(MAX_CAPTURE_ROWS).describe('Una fila por producto o servicio.'),
});

export type CapturePreset = 'productos' | 'servicios';

const SYSTEM_BASE =
  'Eres un asistente que transcribe listas de una clínica veterinaria a filas estructuradas. ' +
  'Transcribe SOLO lo que ves: no inventes productos, precios, cantidades ni categorías. ' +
  'Los números van como TEXTO tal cual aparecen (con sus puntos y comas, ej. "85.000"). ' +
  'Lo que no aparezca en la lista se deja en null. Una fila por renglón/producto.';

const SYSTEM_BY_PRESET: Record<CapturePreset, string> = {
  productos:
    SYSTEM_BASE +
    ' La lista trae PRODUCTOS de inventario (medicamentos, insumos, concentrados…): ' +
    'prioriza nombre, existencia, costo, precio, IVA, lote y vencimiento.',
  servicios:
    SYSTEM_BASE +
    ' La lista trae SERVICIOS veterinarios (consultas, cirugías, vacunación…): ' +
    'prioriza nombre, precio, IVA, categoría y duración en minutos. Marca tipo="servicio".',
};

export type CaptureInput =
  | { kind: 'image'; base64: string; mediaType: string }
  | { kind: 'text'; text: string };

/**
 * Extrae la tabla propuesta desde una foto o texto. Devuelve {columns, rows}
 * en el mismo formato que parseInventoryFile — lista para proposeMapping().
 */
export async function extractImportTable(
  input: CaptureInput,
  opts: { preset?: CapturePreset } = {},
): Promise<{ columns: string[]; rows: Record<string, string>[] }> {
  const preset = opts.preset ?? 'productos';
  const content =
    input.kind === 'image'
      ? ([
          {
            type: 'text',
            text: 'Transcribe esta lista a filas estructuradas. Solo lo que se ve en la imagen.',
          },
          { type: 'image' as const, image: input.base64, mediaType: input.mediaType },
        ] as const)
      : ([
          { type: 'text', text: `Lista (texto):\n"""\n${input.text.slice(0, 20000)}\n"""` },
        ] as const);

  const { object } = await generateObject({
    model: visionModel(),
    schema: TableSchema,
    maxOutputTokens: 8000,
    system: SYSTEM_BY_PRESET[preset],
    messages: [{ role: 'user', content: content as never }],
  });

  return captureRowsToTable(object.rows as CaptureRow[]);
}
