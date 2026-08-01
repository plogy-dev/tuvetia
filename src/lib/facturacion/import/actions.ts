'use server';

// Server actions de importación de inventario (Excel/CSV).
// Flujo: preview (parsea + valida + guarda batch) → corregir mapeo →
// confirmar (crea catálogo + lotes + CARGA_INICIAL) → revertir (si nada
// posterior depende de lo importado).

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { ImportBatchRow } from '@/lib/supabase/types';
import {
  ensureCategoriesByName,
  ensureDefaultCategories,
  ensureSuppliersByName,
  listCategories,
} from '@/lib/facturacion/queries';
import {
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  parseInventoryFile,
  proposeMapping,
  validateRows,
  type ImportMapping,
  type ImportPreset,
  type ImportReport,
  type ValidatedRow,
} from './parse';
import { MAX_CAPTURE_ROWS } from './capture';

const PresetSchema = z.enum(['productos', 'servicios']).catch('productos');

type Err = { ok: false; error: string };
export type ImportResult<P = unknown> = ({ ok: true } & P) | Err;

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

async function requireClinic() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('No autenticado');
  const { data: prof } = await supabase
    .from('profiles')
    .select('clinic_id')
    .eq('id', user.id)
    .maybeSingle();
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id ?? null;
  if (!clinicId) throw new Error('El usuario no tiene clínica');
  return { supabase, clinicId, userId: user.id };
}

function toError(e: unknown): Err {
  return { ok: false, error: e instanceof Error ? e.message : 'Error inesperado' };
}

async function getExistingNames(
  supabase: Awaited<ReturnType<typeof requireClinic>>['supabase'],
  clinicId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('catalog_items')
    .select('name')
    .eq('clinic_id', clinicId);
  if (error) throw new Error(`No se pudo leer el catálogo: ${error.message}`);
  return new Set(((data as { name: string }[]) ?? []).map((r) => r.name.toLowerCase()));
}

export interface PreviewPayload {
  batchId: string;
  fileName: string;
  columns: string[];
  mapping: ImportMapping;
  validated: ValidatedRow[];
  report: ImportReport;
}

/**
 * Camino común de preview: propone mapeo, valida y crea el batch en PREVIEW.
 * Lo comparten el import por archivo y el import por captura IA (foto/texto).
 */
async function buildPreviewBatch(
  supabase: Awaited<ReturnType<typeof requireClinic>>['supabase'],
  clinicId: string,
  createdBy: string,
  fileName: string,
  columns: string[],
  rows: Record<string, string>[],
  preset: ImportPreset,
): Promise<ImportResult<PreviewPayload>> {
  const mapping = proposeMapping(columns);
  const existing = await getExistingNames(supabase, clinicId);
  const { validated, report } = validateRows(rows, mapping, existing, { preset });

  const { data: batch, error } = await supabase
    .from('import_batches')
    .insert({
      clinic_id: clinicId,
      created_by: createdBy,
      file_name: fileName,
      status: 'PREVIEW',
      mapping,
      // preset viaja dentro del jsonb: batches viejos sin preset = 'productos'.
      rows: { columns, raw: rows, validated, preset },
      report,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: `No se pudo guardar la vista previa: ${error.message}` };

  return {
    ok: true,
    batchId: (batch as { id: string }).id,
    fileName,
    columns,
    mapping,
    validated,
    report,
  };
}

/** Sube el archivo, propone el mapeo, valida y crea el batch en PREVIEW. */
export async function createImportPreview(
  formData: FormData,
): Promise<ImportResult<PreviewPayload>> {
  // GUARDA (deuda xlsx, ver ESTADO.md): esta es la ÚNICA action que parsea la planilla del usuario
  // con xlsx@0.18.5 en el servidor (prototype pollution + ReDoS, sin fix en npm). Quedó registrada
  // como endpoint al portar ImportBatchesList (importar CUALQUIER export de un módulo 'use server'
  // registra TODAS sus actions), así que la guarda va acá adentro, antes de tocar el archivo.
  // createImportPreviewFromCapture (foto/texto vía visión) y revertImport siguen activas — no usan
  // xlsx. Constante de CÓDIGO y no flag de env, a propósito: un env permitiría rehabilitar el
  // parser vulnerable sin reemplazar la lib. Se levanta editando esta línea cuando entre el parser
  // seguro. (El `as boolean` evita que TS marque el resto como inalcanzable y pierda el narrowing.)
  const XLSX_IMPORT_ENABLED = false as boolean;
  if (!XLSX_IMPORT_ENABLED) {
    return {
      ok: false,
      error:
        'La importación desde Excel está deshabilitada temporalmente. Podés cargar el catálogo con una foto de la planilla (Importar con IA) o ítem por ítem.',
    };
  }
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: 'Selecciona un archivo .csv o .xlsx' };
    }
    if (file.size > MAX_FILE_BYTES) {
      return { ok: false, error: 'El archivo supera 2 MB. Divide la planilla.' };
    }
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
      return { ok: false, error: 'Formato no soportado (usa .csv, .xlsx o .xls)' };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { columns, rows } = parseInventoryFile(buffer, file.name);
    if (rows.length === 0) return { ok: false, error: 'El archivo no contiene filas de datos' };
    if (rows.length > MAX_IMPORT_ROWS) {
      return { ok: false, error: `Máximo ${MAX_IMPORT_ROWS} filas por importación (trae ${rows.length})` };
    }

    const preset = PresetSchema.parse(formData.get('preset') ?? 'productos');
    return await buildPreviewBatch(supabase, clinicId, userId, file.name, columns, rows, preset);
  } catch (e) {
    return toError(e);
  }
}

// Captura IA: foto o texto pegado → la IA transcribe a la tabla del wizard y
// el resultado entra al MISMO preview/validación/commit. Límite del base64
// ≈ 5,5 M de caracteres (~4 MB de imagen); el cliente re-encodea antes.
const CaptureInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    base64: z.string().min(10).max(5_500_000),
    mediaType: z.string().regex(/^image\//),
  }),
  z.object({ kind: z.literal('text'), text: z.string().min(3).max(20_000) }),
]);

/** Crea un preview de importación desde una foto o texto, vía IA (solo propone). */
export async function createImportPreviewFromCapture(input: {
  kind: 'image' | 'text';
  base64?: string;
  mediaType?: string;
  text?: string;
  preset?: ImportPreset;
}): Promise<ImportResult<PreviewPayload>> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const parsed = CaptureInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: 'Entrada inválida (imagen muy grande o texto vacío)' };
    }
    const preset = PresetSchema.parse(input.preset ?? 'productos');

    const { extractImportTable } = await import('./ingest');
    const { columns, rows } = await extractImportTable(parsed.data, { preset, clinicId });
    if (rows.length === 0) {
      return {
        ok: false,
        error:
          'No se reconoció ningún producto en la captura. Prueba con una foto más nítida o pega el texto.',
      };
    }
    if (rows.length >= MAX_CAPTURE_ROWS) {
      return {
        ok: false,
        error: `La captura trae demasiadas filas (máx. ${MAX_CAPTURE_ROWS}). Divide la foto o usa Excel.`,
      };
    }

    const label = parsed.data.kind === 'image' ? 'Foto (IA)' : 'Texto (IA)';
    const fileName = `${label} · ${new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}`;
    return await buildPreviewBatch(supabase, clinicId, userId, fileName, columns, rows, preset);
  } catch (e) {
    return toError(e);
  }
}

const MappingSchema = z.object({
  batchId: z.string().uuid(),
  mapping: z.record(
    z.string(),
    z.union([z.enum(IMPORT_FIELDS), z.literal('')]),
  ),
});

/** Re-valida con el mapeo corregido por el vet y actualiza el batch. */
export async function updateImportMapping(input: {
  batchId: string;
  mapping: ImportMapping;
}): Promise<ImportResult<{ validated: ValidatedRow[]; report: ImportReport }>> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const parsed = MappingSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Mapeo inválido' };

    const { data: batch, error } = await supabase
      .from('import_batches')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('id', parsed.data.batchId)
      .maybeSingle();
    if (error || !batch) return { ok: false, error: 'Importación no encontrada' };
    const b = batch as ImportBatchRow;
    if (b.status !== 'PREVIEW') {
      return { ok: false, error: 'La importación ya fue confirmada o revertida' };
    }

    const rowsJson = b.rows as {
      columns: string[];
      raw: Record<string, string>[];
      preset?: ImportPreset;
    };
    const preset = PresetSchema.parse(rowsJson.preset ?? 'productos');
    const existing = await getExistingNames(supabase, clinicId);
    const { validated, report } = validateRows(
      rowsJson.raw ?? [],
      parsed.data.mapping,
      existing,
      { preset },
    );

    const { error: updErr } = await supabase
      .from('import_batches')
      .update({ mapping: parsed.data.mapping, rows: { ...rowsJson, validated }, report })
      .eq('id', b.id)
      .eq('clinic_id', clinicId);
    if (updErr) return { ok: false, error: updErr.message };

    return { ok: true, validated, report };
  } catch (e) {
    return toError(e);
  }
}

/** Confirma: crea ítems + lotes + CARGA_INICIAL, marca COMMITTED. */
export async function commitImport(input: {
  batchId: string;
}): Promise<ImportResult<{ created: number }>> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const batchId = z.string().uuid().parse(input.batchId);

    const { data: batch, error } = await supabase
      .from('import_batches')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('id', batchId)
      .maybeSingle();
    if (error || !batch) return { ok: false, error: 'Importación no encontrada' };
    const b = batch as ImportBatchRow;
    if (b.status !== 'PREVIEW') {
      return { ok: false, error: 'La importación ya fue confirmada o revertida' };
    }

    const validated = ((b.rows as { validated?: ValidatedRow[] }).validated ?? []).filter(
      (r) => (r.status === 'OK' || r.status === 'AVISO') && r.parsed,
    );
    if (validated.length === 0) {
      return { ok: false, error: 'No hay filas importables (todas con error o duplicadas)' };
    }

    // Categorías REALES: get-or-create por nombre; las filas sin categoría van
    // a la default «Sin categoría».
    await ensureDefaultCategories(supabase, clinicId, userId);
    const categoryNames = validated
      .map((r) => r.parsed!.category)
      .filter((c): c is string => !!c && c.trim().length > 0);
    const catMap = await ensureCategoriesByName(supabase, clinicId, categoryNames, userId);
    const defaultCategoryId =
      (await listCategories(supabase, clinicId)).find((c) => c.is_default)?.id ?? null;

    // Proveedores REALES: la columna «Proveedor» crea/vincula suppliers.
    const supplierNames = validated
      .map((r) => r.parsed!.supplier)
      .filter((s): s is string => !!s && s.trim().length > 0);
    const supMap = await ensureSuppliersByName(supabase, clinicId, supplierNames, userId);

    let created = 0;
    for (const row of validated) {
      const p = row.parsed!;
      const { data: item, error: itemErr } = await supabase
        .from('catalog_items')
        .insert({
          clinic_id: clinicId,
          created_by: userId,
          item_type: p.kind,
          name: p.name,
          sku: p.sku,
          category_id:
            (p.category && catMap.get(p.category.trim().toLowerCase())) || defaultCategoryId,
          purchase_unit: p.purchaseUnit,
          use_unit: p.useUnit,
          conversion_factor: p.conversionFactor,
          price_cents: p.priceCents,
          cost_cents: p.costCents || null,
          tax_rate: p.taxRate,
          tax_status: p.taxStatus,
          track_stock: p.kind !== 'SERVICIO',
          min_stock: p.minStock || null,
          duration_minutes: p.durationMinutes,
          supplier: p.supplier,
          supplier_id:
            (p.supplier && supMap.get(p.supplier.trim().toLowerCase())) || null,
          location: p.location,
          active: true,
          import_batch_id: b.id,
        })
        .select('id')
        .single();
      if (itemErr) {
        // Import parcial: lo ya creado queda ligado al batch y puede revertirse.
        return {
          ok: false,
          error: `Falló en la fila ${row.index + 1} («${p.name}»): ${itemErr.message}. ` +
            `Se crearon ${created} ítems — puedes revertir la importación e intentar de nuevo.`,
        };
      }
      const itemId = (item as { id: string }).id;

      let lotId: string | null = null;
      if (p.lotNumber) {
        const { data: lot } = await supabase
          .from('catalog_lots')
          .insert({ item_id: itemId, lot_code: p.lotNumber, expires_on: p.expiresAt })
          .select('id')
          .single();
        lotId = (lot as { id: string } | null)?.id ?? null;
      }
      if (p.initialQty > 0 && p.kind !== 'SERVICIO') {
        await supabase.from('inventory_movements').insert({
          clinic_id: clinicId,
          created_by: userId,
          item_id: itemId,
          lot_id: lotId,
          qty: p.initialQty,
          movement_type: 'CARGA_INICIAL',
          ref_type: 'IMPORT_BATCH',
          ref_id: b.id,
          note: `Importación ${b.file_name}`,
          import_batch_id: b.id,
        });
      }
      created++;
    }

    await supabase
      .from('import_batches')
      .update({ status: 'COMMITTED', committed_at: new Date().toISOString() })
      .eq('id', b.id)
      .eq('clinic_id', clinicId);

    revalidatePath('/dashboard/facturacion/inventario');
    return { ok: true, created };
  } catch (e) {
    return toError(e);
  }
}

/** Revierte una importación confirmada si nada posterior depende de ella. */
export async function revertImport(input: {
  batchId: string;
}): Promise<ImportResult<{ removedItems: number }>> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const batchId = z.string().uuid().parse(input.batchId);

    const { data: batch, error } = await supabase
      .from('import_batches')
      .select('id, status')
      .eq('clinic_id', clinicId)
      .eq('id', batchId)
      .maybeSingle();
    if (error || !batch) return { ok: false, error: 'Importación no encontrada' };
    if ((batch as { status: string }).status !== 'COMMITTED') {
      return { ok: false, error: 'Solo se revierte una importación confirmada' };
    }

    const { data: items } = await supabase
      .from('catalog_items')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('import_batch_id', batchId);
    const itemIds = ((items as { id: string }[]) ?? []).map((i) => i.id);

    if (itemIds.length > 0) {
      // ¿Movimientos posteriores (ventas, ajustes) sobre los ítems importados?
      const { count: extMovements } = await supabase
        .from('inventory_movements')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .in('item_id', itemIds)
        .not('import_batch_id', 'eq', batchId);
      // ¿Facturas que ya referencian estos ítems?
      const { count: usedInInvoices } = await supabase
        .from('invoice_lines')
        .select('id', { count: 'exact', head: true })
        .in('catalog_item_id', itemIds);
      if ((extMovements ?? 0) > 0 || (usedInInvoices ?? 0) > 0) {
        return {
          ok: false,
          error:
            'No se puede revertir: existen movimientos o facturas que dependen de los productos importados',
        };
      }

      await supabase.from('inventory_movements').delete().eq('import_batch_id', batchId);
      const { error: delItemsErr } = await supabase
        .from('catalog_items')
        .delete()
        .eq('clinic_id', clinicId)
        .eq('import_batch_id', batchId);
      if (delItemsErr) return { ok: false, error: delItemsErr.message };
    }

    await supabase
      .from('import_batches')
      .update({ status: 'REVERTED', reverted_at: new Date().toISOString() })
      .eq('id', batchId)
      .eq('clinic_id', clinicId);

    revalidatePath('/dashboard/facturacion/inventario');
    return { ok: true, removedItems: itemIds.length };
  } catch (e) {
    return toError(e);
  }
}
