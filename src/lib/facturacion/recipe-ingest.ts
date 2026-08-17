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
import { consultarPresupuesto, mensajeSinCupo } from '@/lib/athos-agent/presupuesto';
import { MENSAJE_REQUIERE_PRO } from '@/lib/planes';
import { clinicaPuede } from '@/lib/planes/servidor';
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

  // TOPE MENSUAL DE IA DE LA CLÍNICA. La visión es Anthropic sí o sí y es de lo más caro por
  // llamada, así que no puede quedar fuera del cupo compartido.
  //
  // Lanza en vez de devolver un borrador vacío: acá SÍ hay una persona esperando la pantalla, y un
  // borrador vacío se leería como "la foto no se entendió" — mandándola a repetirla y a gastar de
  // nuevo. El mensaje sube tal cual hasta la UI.
  const presupuesto = await consultarPresupuesto(clinicId);
  if (!presupuesto.permitido) throw new Error(mensajeSinCupo(presupuesto));

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
    // Un Excel SIN columnas claras cae al modelo, así que también es de Pro. El de columnas claras
    // salió arriba sin gastar nada y sigue siendo gratis: el corte es por gasto, no por formato.
    await exigirPlanPro(opts.clinicId);
    // Sin columnas claras: el modelo lee el CSV crudo como texto.
    return extractWithModel({ kind: 'text', text: spreadsheetToCsv(input.base64) }, opts.clinicId);
  }
  if (input.kind === 'image') {
    await exigirPlanPro(opts.clinicId);
    return extractWithModel(
      { kind: 'image', base64: input.base64, mediaType: input.mediaType },
      opts.clinicId,
    );
  }
  await exigirPlanPro(opts.clinicId);
  return extractWithModel({ kind: 'text', text: input.text }, opts.clinicId);
}

/**
 * Corta la lectura por IA cuando la clínica no es Pro.
 *
 * LANZA, a diferencia de los otros gates de este trabajo, y es por dónde se llama: acá hay una
 * persona esperando frente a una pantalla que acaba de subir una foto. Devolver un borrador vacío
 * en silencio se leería como "la foto no se entendió" y la haría reintentar. La excepción sube
 * hasta la acción, que le muestra la ventana de invitación a Pro.
 *
 * `RequierePlanPro` se distingue por su `name`, no por el texto del mensaje: quien la atrapa tiene
 * que poder separarla de un fallo real del modelo sin leer strings.
 */
async function exigirPlanPro(clinicId: string): Promise<void> {
  if (await clinicaPuede(clinicId, 'receta-por-foto')) return;
  const e = new Error(`${MENSAJE_REQUIERE_PRO['receta-por-foto']} Subí de plan para usarlo.`);
  e.name = 'RequierePlanPro';
  throw e;
}
