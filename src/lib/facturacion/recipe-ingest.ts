import 'server-only';

// Extracción de una receta de consumo desde lo que el vet suba: imagen (foto de
// una receta escrita a mano o impresa), Excel/CSV o texto libre. La IA SOLO
// PROPONE un borrador estructurado {servicio?, componentes:[{nombre,cantidad,
// unidad}]}; nunca crea la receta ni toca stock. El vet revisa, corrige el
// emparejamiento con el catálogo y confirma (saveServiceRecipeAction).
//
// Excel/CSV se parsea de forma determinista (sin modelo) cuando tiene columnas
// reconocibles; si no, cae al extractor de texto (el modelo lee el CSV crudo).
//
// Modelo: visionModel() de la fábrica de Athos (contrato §7) — nunca
// hardcodeado; default claude-haiku-4-5, configurable con ATHOS_VISION_MODEL.

import { generateObject } from 'ai';
import { z } from 'zod';
import { visionModel } from '@/lib/athos-agent/model';
import { registrarUso } from '@/lib/athos-agent/usage';
import type { RecipeDraft } from '@/lib/facturacion/domain/recipes';
import { parseSpreadsheetDraft, spreadsheetToCsv } from '@/lib/facturacion/domain/recipe-parse';

const DraftSchema = z.object({
  serviceName: z.string().nullable().describe('Nombre del servicio/procedimiento si la receta lo menciona; si no, null.'),
  components: z
    .array(
      z.object({
        name: z.string().describe('Nombre del producto/medicamento/insumo consumido.'),
        qty: z.number().positive().describe('Cantidad consumida por una unidad del servicio.'),
        unit: z.string().nullable().describe('Unidad si aparece (ml, tableta, unidad…); si no, null.'),
      }),
    )
    .describe('Insumos que consume el servicio. Vacío si no se distingue ninguno.'),
});

const SYSTEM =
  'Eres un asistente que transcribe RECETAS DE CONSUMO de una clínica veterinaria a una lista ' +
  'estructurada. Una receta dice qué insumos (productos, medicamentos, material) consume UN ' +
  'procedimiento/servicio y en qué cantidad. Extrae SOLO lo que ves; no inventes insumos ni ' +
  'cantidades. Si una cantidad no está clara, usa 1. Si no hay unidad, deja null. Devuelve el ' +
  'nombre del servicio si aparece.';

type IngestInput =
  | { kind: 'text'; text: string }
  | { kind: 'excel'; base64: string }
  | { kind: 'image'; base64: string; mediaType: string };

async function extractWithModel(
  parts:
    | { kind: 'text'; text: string }
    | { kind: 'image'; base64: string; mediaType: string },
  clinicId: string,
): Promise<RecipeDraft> {
  const content =
    parts.kind === 'image'
      ? ([
          { type: 'text', text: 'Transcribe esta receta de consumo a la lista estructurada.' },
          { type: 'image' as const, image: parts.base64, mediaType: parts.mediaType },
        ] as const)
      : ([{ type: 'text', text: `Receta (texto):\n"""\n${parts.text.slice(0, 6000)}\n"""` }] as const);

  const elegido = visionModel();
  const { object, usage } = await generateObject({
    model: elegido.model,
    schema: DraftSchema,
    maxOutputTokens: 1500,
    system: SYSTEM,
    messages: [{ role: 'user', content: content as never }],
  });

  // La visión es Anthropic sí o sí, y era el gasto más invisible de todos: ninguna tabla lo veía.
  void registrarUso({ clinicId, surface: 'vision_recipe', elegido, usage });

  return { serviceName: object.serviceName, components: object.components };
}

/**
 * Devuelve el borrador de receta desde la entrada del vet. La IA solo propone.
 *
 * `clinicId` es sólo para registrar el consumo (0046): el camino de Excel con columnas claras ni
 * siquiera llama al modelo, y ahí no se registra nada porque no se gastó nada.
 */
export async function extractRecipeDraft(
  input: IngestInput,
  opts: { clinicId: string },
): Promise<RecipeDraft> {
  if (input.kind === 'excel') {
    const parsed = parseSpreadsheetDraft(input.base64);
    if (parsed) return parsed;
    // Sin columnas claras: el modelo lee el CSV crudo como texto.
    return extractWithModel({ kind: 'text', text: spreadsheetToCsv(input.base64) }, opts.clinicId);
  }
  if (input.kind === 'image') {
    return extractWithModel(
      { kind: 'image', base64: input.base64, mediaType: input.mediaType },
      opts.clinicId,
    );
  }
  return extractWithModel({ kind: 'text', text: input.text }, opts.clinicId);
}
