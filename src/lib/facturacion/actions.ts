'use server';

// Server actions del módulo de facturación. Patrón "argumentos directos +
// Result": cada action valida input con Zod, autentica con la sesión y
// devuelve {ok:true,...}|{ok:false,error}. RLS es el backstop; clinic_id
// (tenancy) + created_by (autoría) se inyectan en cada insert (contrato §1).

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  CATALOG_KINDS,
  DOC_KINDS,
  MANUAL_PAYMENT_METHODS,
  TAX_RATES,
  TAX_STATUSES,
} from '@/lib/facturacion/domain/types';
import { validateMovementSign } from '@/lib/facturacion/domain/inventory';
import {
  createDraftInvoice,
  discardDraft,
  issueInvoice,
  registerManualPayment,
  setInvoiceRemindersPaused,
  type DraftPreview,
  type IssueResult,
} from './invoices';
import { ensurePayerForOwner, getOrCreateConsumidorFinal, listCatalogItems } from './queries';
import { sendInvoiceByEmail } from './email';
import { extractRecipeDraft } from './recipe-ingest';
import { resolveDraft, type ResolvedComponent } from './domain/recipes';
import { DEFAULT_UVT_VALUE_CENTS, DEFAULT_UVT_YEAR } from './constants';
import type { BillingSettingsRow, CatalogItemRow, InvoiceRow } from '@/lib/supabase/types';

type Err = { ok: false; error: string };
export type Result<P = unknown> = ({ ok: true } & P) | Err;

/** Sesión + clínica del usuario (tenancy) + su id (autoría). */
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

// ─── Activación / configuración del emisor ───────────────────────────────────

const SettingsSchema = z.object({
  fiscalName: z.string().trim().min(1, 'Nombre o razón social requerido'),
  fiscalIdType: z.enum(['NIT', 'CC', 'CE']),
  fiscalIdNumber: z.string().trim().min(3, 'Número de identificación requerido'),
  fiscalRegime: z.enum(['COMUN', 'SIMPLE', 'NO_RESPONSABLE']),
  fiscalAddress: z.string().trim().nullish(),
  municipalityCode: z.string().trim().nullish(),
  departmentCode: z.string().trim().nullish(),
  defaultDocKind: z.enum(DOC_KINDS).default('POS'),
  inventoryEnabled: z.boolean().default(true),
  remindersEnabled: z.boolean().default(false),
  blockOnInsufficientStock: z.boolean().default(false),
});

export type SaveSettingsInput = z.input<typeof SettingsSchema>;

/**
 * Guarda los datos fiscales del emisor y ACTIVA el módulo. Upsert por clínica
 * (billing_settings tiene UNIQUE(clinic_id)).
 */
export async function saveBillingSettings(
  input: SaveSettingsInput,
): Promise<Result<{ settings: BillingSettingsRow }>> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const parsed = SettingsSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
    }
    const d = parsed.data;
    // Merge con lo existente: el formulario no tiene campo de departamento y mandaba
    // departmentCode:null fijo — cada guardado BORRABA el valor previo; y el upsert reescribía
    // uvt_year/uvt_value_cents con las constantes, pisando cualquier valor personalizado.
    // Lo que el formulario no edita, no se toca.
    const { data: previo } = await supabase
      .from('billing_settings')
      .select('department_code, uvt_year, uvt_value_cents')
      .eq('clinic_id', clinicId)
      .maybeSingle<{ department_code: string | null; uvt_year: number; uvt_value_cents: number }>();
    const { data, error } = await supabase
      .from('billing_settings')
      .upsert(
        {
          clinic_id: clinicId,
          created_by: userId,
          module_status: 'ACTIVO',
          billing_enabled: true,
          inventory_enabled: d.inventoryEnabled,
          reminders_enabled: d.remindersEnabled,
          fiscal_name: d.fiscalName,
          fiscal_id_type: d.fiscalIdType,
          fiscal_id_number: d.fiscalIdNumber,
          fiscal_regime: d.fiscalRegime,
          fiscal_address: d.fiscalAddress ?? null,
          municipality_code: d.municipalityCode ?? null,
          department_code: d.departmentCode ?? previo?.department_code ?? null,
          default_doc_kind: d.defaultDocKind,
          block_on_insufficient_stock: d.blockOnInsufficientStock,
          uvt_year: previo?.uvt_year ?? DEFAULT_UVT_YEAR,
          uvt_value_cents: previo?.uvt_value_cents ?? DEFAULT_UVT_VALUE_CENTS,
        },
        { onConflict: 'clinic_id' },
      )
      .select('*')
      .single();
    if (error) return { ok: false, error: `No se pudo guardar: ${error.message}` };
    revalidatePath('/dashboard/facturacion');
    return { ok: true, settings: data as BillingSettingsRow };
  } catch (e) {
    return toError(e);
  }
}

// ─── Catálogo ────────────────────────────────────────────────────────────────

const CatalogItemSchema = z
  .object({
    id: z.string().uuid().nullish(),
    itemType: z.enum(CATALOG_KINDS),
    name: z.string().trim().min(1, 'Nombre requerido'),
    sku: z.string().trim().nullish(),
    description: z.string().trim().nullish(),
    purchaseUnit: z.string().trim().min(1).default('unidad'),
    useUnit: z.string().trim().min(1).default('unidad'),
    conversionFactor: z.number().positive().default(1),
    priceCents: z.number().int().min(0),
    costCents: z.number().int().min(0).nullish(),
    taxRate: z
      .number()
      .refine((v): v is (typeof TAX_RATES)[number] => (TAX_RATES as readonly number[]).includes(v), {
        message: 'Tarifa de IVA no soportada (0, 5 o 19)',
      }),
    taxStatus: z.enum(TAX_STATUSES).default('GRAVADO'),
    trackStock: z.boolean().default(false),
    minStock: z.number().min(0).nullish(),
    supplier: z.string().trim().nullish(),
    supplierId: z.string().uuid().nullish(),
    location: z.string().trim().nullish(),
    active: z.boolean().default(true),
    categoryId: z.string().uuid().nullish(),
    durationMinutes: z.number().int().min(0).nullish(),
    barcode: z.string().trim().nullish(),
    activeIngredient: z.string().trim().nullish(),
    concentration: z.string().trim().nullish(),
    presentation: z.string().trim().nullish(),
    manufacturer: z.string().trim().nullish(),
  })
  .superRefine((d, ctx) => {
    if (d.taxStatus !== 'GRAVADO' && d.taxRate !== 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Un ítem excluido o exento debe tener tarifa 0',
        path: ['taxRate'],
      });
    }
  });

export type UpsertCatalogItemInput = z.input<typeof CatalogItemSchema>;

export async function upsertCatalogItem(
  input: UpsertCatalogItemInput,
): Promise<Result<{ item: CatalogItemRow }>> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const parsed = CatalogItemSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
    }
    const d = parsed.data;
    const row = {
      item_type: d.itemType,
      name: d.name,
      sku: d.sku ?? null,
      description: d.description ?? null,
      purchase_unit: d.purchaseUnit,
      use_unit: d.useUnit,
      conversion_factor: d.conversionFactor,
      price_cents: d.priceCents,
      cost_cents: d.costCents ?? null,
      tax_rate: d.taxRate,
      tax_status: d.taxStatus,
      track_stock: d.trackStock,
      min_stock: d.minStock ?? null,
      supplier: d.supplier ?? null,
      supplier_id: d.supplierId ?? null,
      location: d.location ?? null,
      active: d.active,
      category_id: d.categoryId ?? null,
      duration_minutes: d.durationMinutes ?? null,
      barcode: d.barcode ?? null,
      active_ingredient: d.activeIngredient ?? null,
      concentration: d.concentration ?? null,
      presentation: d.presentation ?? null,
      manufacturer: d.manufacturer ?? null,
    };
    const query = d.id
      ? supabase.from('catalog_items').update(row).eq('id', d.id).eq('clinic_id', clinicId)
      : supabase.from('catalog_items').insert({ clinic_id: clinicId, created_by: userId, ...row });
    const { data, error } = await query.select('*').single();
    if (error) return { ok: false, error: `No se pudo guardar el ítem: ${error.message}` };
    revalidatePath('/dashboard/facturacion/inventario');
    revalidatePath('/dashboard/facturacion/catalogo');
    return { ok: true, item: data as CatalogItemRow };
  } catch (e) {
    return toError(e);
  }
}

/** Archiva o reactiva un ítem (archivar = active=false; el carrito solo ofrece activos). */
export async function setCatalogItemActiveAction(
  input: { id: string; active: boolean },
): Promise<Result> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const { id, active } = z
      .object({ id: z.string().uuid(), active: z.boolean() })
      .parse(input);
    const { error } = await supabase
      .from('catalog_items')
      .update({ active })
      .eq('id', id)
      .eq('clinic_id', clinicId);
    if (error) return { ok: false, error: `No se pudo actualizar el ítem: ${error.message}` };
    revalidatePath('/dashboard/facturacion/inventario');
    revalidatePath('/dashboard/facturacion/catalogo');
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

/** Cambia la categoría de un ítem (asignación rápida desde el catálogo). */
export async function setCatalogItemCategoryAction(
  input: { id: string; categoryId: string | null },
): Promise<Result> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const { id, categoryId } = z
      .object({ id: z.string().uuid(), categoryId: z.string().uuid().nullable() })
      .parse(input);
    const { error } = await supabase
      .from('catalog_items')
      .update({ category_id: categoryId })
      .eq('id', id)
      .eq('clinic_id', clinicId);
    if (error) return { ok: false, error: `No se pudo mover el ítem: ${error.message}` };
    revalidatePath('/dashboard/facturacion/inventario');
    revalidatePath('/dashboard/facturacion/catalogo');
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

// ─── Categorías ──────────────────────────────────────────────────────────────

/** Crea o renombra una categoría. El nombre es único (case-insensitive) por clínica. */
export async function upsertCategoryAction(
  input: { id?: string | null; name: string; parentId?: string | null },
): Promise<Result<{ id: string }>> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const d = z
      .object({
        id: z.string().uuid().nullish(),
        name: z.string().trim().min(1, 'Nombre requerido').max(60),
        parentId: z.string().uuid().nullish(),
      })
      .parse(input);
    const payload = { name: d.name, parent_id: d.parentId ?? null };
    const query = d.id
      ? supabase.from('catalog_categories').update(payload).eq('id', d.id).eq('clinic_id', clinicId)
      : supabase
          .from('catalog_categories')
          .insert({ clinic_id: clinicId, created_by: userId, ...payload });
    const { data, error } = await query.select('id').single();
    if (error) {
      if (error.code === '23505') return { ok: false, error: 'Ya existe una categoría con ese nombre' };
      return { ok: false, error: `No se pudo guardar la categoría: ${error.message}` };
    }
    revalidatePath('/dashboard/facturacion/inventario');
    revalidatePath('/dashboard/facturacion/catalogo');
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return toError(e);
  }
}

/**
 * Archiva o reactiva una categoría. No se archiva la default. Al archivar, sus
 * ítems quedan sin categoría (los recoge la default en el panel).
 */
export async function setCategoryArchivedAction(
  input: { id: string; archived: boolean },
): Promise<Result> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const { id, archived } = z
      .object({ id: z.string().uuid(), archived: z.boolean() })
      .parse(input);

    const { data: cat } = await supabase
      .from('catalog_categories')
      .select('is_default')
      .eq('id', id)
      .eq('clinic_id', clinicId)
      .maybeSingle<{ is_default: boolean }>();
    if (cat?.is_default) return { ok: false, error: 'La categoría «Sin categoría» no se puede archivar' };

    if (archived) {
      // Desasignar sus ítems antes de archivar (quedan «sin categoría»).
      await supabase
        .from('catalog_items')
        .update({ category_id: null })
        .eq('clinic_id', clinicId)
        .eq('category_id', id);
    }
    const { error } = await supabase
      .from('catalog_categories')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', id)
      .eq('clinic_id', clinicId);
    if (error) return { ok: false, error: `No se pudo archivar la categoría: ${error.message}` };
    revalidatePath('/dashboard/facturacion/inventario');
    revalidatePath('/dashboard/facturacion/catalogo');
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

/** Reordena categorías: recibe los ids en el nuevo orden y fija sort_order. */
export async function reorderCategoriesAction(
  input: { orderedIds: string[] },
): Promise<Result> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const { orderedIds } = z.object({ orderedIds: z.array(z.string().uuid()) }).parse(input);
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabase
        .from('catalog_categories')
        .update({ sort_order: i })
        .eq('id', orderedIds[i])
        .eq('clinic_id', clinicId);
      if (error) return { ok: false, error: `No se pudo reordenar: ${error.message}` };
    }
    revalidatePath('/dashboard/facturacion/inventario');
    revalidatePath('/dashboard/facturacion/catalogo');
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

// ─── Recetas de consumo ──────────────────────────────────────────────────────

const RecipeSchema = z.object({
  serviceId: z.string().uuid(),
  components: z
    .array(
      z.object({
        componentId: z.string().uuid(),
        qty: z.number().positive('La cantidad debe ser mayor a 0'),
        note: z.string().trim().nullish(),
      }),
    )
    .max(50),
});

/**
 * Guarda la receta de un servicio (reemplaza la existente). El vet CONFIRMA lo
 * que la IA propuso: acá solo se persiste lo confirmado. No permite que un
 * servicio se consuma a sí mismo ni componentes duplicados.
 */
export async function saveServiceRecipeAction(
  input: z.input<typeof RecipeSchema>,
): Promise<Result> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const d = RecipeSchema.parse(input);
    const seen = new Set<string>();
    for (const c of d.components) {
      if (c.componentId === d.serviceId) {
        return { ok: false, error: 'Un servicio no puede consumirse a sí mismo' };
      }
      if (seen.has(c.componentId)) {
        return { ok: false, error: 'Hay un componente repetido en la receta' };
      }
      seen.add(c.componentId);
    }

    // Reemplazo total: borrar la receta previa e insertar la confirmada.
    const { error: delErr } = await supabase
      .from('service_consumptions')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('service_id', d.serviceId);
    if (delErr) return { ok: false, error: `No se pudo actualizar la receta: ${delErr.message}` };

    if (d.components.length > 0) {
      const rows = d.components.map((c) => ({
        clinic_id: clinicId,
        created_by: userId,
        service_id: d.serviceId,
        component_id: c.componentId,
        qty: c.qty,
        note: c.note ?? null,
      }));
      const { error: insErr } = await supabase.from('service_consumptions').insert(rows);
      if (insErr) return { ok: false, error: `No se pudo guardar la receta: ${insErr.message}` };
    }
    revalidatePath('/dashboard/facturacion/catalogo');
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

const IngestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(8000) }),
  z.object({ kind: z.literal('excel'), base64: z.string().min(1) }),
  z.object({ kind: z.literal('image'), base64: z.string().min(1), mediaType: z.string().min(1) }),
]);

/**
 * Extrae un BORRADOR de receta desde imagen/Excel/texto y lo empareja con el
 * catálogo. NO guarda nada: devuelve el borrador para que el vet lo revise y
 * confirme (saveServiceRecipeAction). La IA solo propone.
 */
export async function ingestRecipeAction(
  input: z.input<typeof IngestSchema>,
): Promise<Result<{ serviceName: string | null; components: ResolvedComponent[] }>> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const parsed = IngestSchema.parse(input);
    // GUARDA (deuda xlsx documentada en ESTADO.md): kind='excel' es la ÚNICA rama que parsea el
    // archivo con xlsx@0.18.5 en el SERVIDOR, y esa lib tiene prototype pollution + ReDoS sin fix
    // en npm. La guarda vive ACÁ y no en la UI porque la server action es un endpoint público para
    // cualquier autenticado: restringir el <input accept> no cierra nada. Imagen y texto (visión /
    // modelo liviano, sin xlsx) siguen activos. Se levanta cuando se reemplace la lib.
    if (parsed.kind === 'excel') {
      return {
        ok: false,
        error:
          'La importación desde Excel está deshabilitada temporalmente. Podés subir una foto de la receta o escribirla como texto.',
      };
    }
    const draft = await extractRecipeDraft(parsed);
    // Candidatos: ítems activos que NO son servicios (componentes de consumo).
    const items = await listCatalogItems(supabase, clinicId, {});
    const candidates = items
      .filter((i) => i.item_type !== 'SERVICIO')
      .map((i) => ({ id: i.id, name: i.name }));
    const resolved = resolveDraft(draft, candidates);
    return { ok: true, serviceName: draft.serviceName ?? null, components: resolved };
  } catch (e) {
    return toError(e);
  }
}

/** Lee la receta actual de un servicio (para el editor). */
export async function getServiceRecipeAction(
  input: { serviceId: string },
): Promise<Result<{ components: { componentId: string; qty: number; note: string | null }[] }>> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const { serviceId } = z.object({ serviceId: z.string().uuid() }).parse(input);
    const { data, error } = await supabase
      .from('service_consumptions')
      .select('component_id, qty, note')
      .eq('clinic_id', clinicId)
      .eq('service_id', serviceId)
      .order('created_at', { ascending: true });
    if (error) return { ok: false, error: error.message };
    const components = ((data as { component_id: string; qty: number; note: string | null }[]) ?? []).map(
      (r) => ({ componentId: r.component_id, qty: Number(r.qty), note: r.note }),
    );
    return { ok: true, components };
  } catch (e) {
    return toError(e);
  }
}

export async function deleteServiceRecipeAction(
  input: { serviceId: string },
): Promise<Result> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const { serviceId } = z.object({ serviceId: z.string().uuid() }).parse(input);
    const { error } = await supabase
      .from('service_consumptions')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('service_id', serviceId);
    if (error) return { ok: false, error: `No se pudo borrar la receta: ${error.message}` };
    revalidatePath('/dashboard/facturacion/catalogo');
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

/** Movimiento manual de inventario (carga inicial, ajuste, compra…). */
const ManualMovementSchema = z.object({
  itemId: z.string().uuid(),
  qty: z.number().refine((v) => v !== 0, 'La cantidad no puede ser cero'),
  movementType: z.enum([
    'CARGA_INICIAL',
    'ENTRADA_COMPRA',
    'DEVOLUCION',
    'CONSUMO_INTERNO',
    'VENCIMIENTO',
    'PERDIDA',
    'AJUSTE',
  ]),
  note: z.string().trim().nullish(),
});

export type ManualMovementInput = z.input<typeof ManualMovementSchema>;

export async function registerInventoryMovement(
  input: ManualMovementInput,
): Promise<Result> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const parsed = ManualMovementSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
    }
    const d = parsed.data;
    // Validación de signos del dominio (INBOUND positivo, OUTBOUND negativo).
    validateMovementSign({ qty: d.qty, type: d.movementType });
    const { error } = await supabase.from('inventory_movements').insert({
      clinic_id: clinicId,
      created_by: userId,
      item_id: d.itemId,
      qty: d.qty,
      movement_type: d.movementType,
      ref_type: 'MANUAL',
      note: d.note ?? null,
    });
    if (error) return { ok: false, error: `No se pudo registrar el movimiento: ${error.message}` };
    revalidatePath('/dashboard/facturacion');
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

// ─── Borradores y emisión ────────────────────────────────────────────────────

const DraftLineSchema = z.object({
  catalogItemId: z.string().uuid().nullish(),
  description: z.string().trim().nullish(),
  qty: z.number().positive('La cantidad debe ser positiva'),
  unitPriceCents: z.number().int().min(0).nullish(),
  taxRate: z.number().nullish(),
  discountCents: z.number().int().min(0).nullish(),
});

const CreateDraftSchema = z.object({
  /** Uno de los dos: payer directo, u owner del CRM (se crea/reusa su payer). */
  payerId: z.string().uuid().nullish(),
  ownerId: z.string().uuid().nullish(),
  /** Sin payer ni owner → venta de mostrador a "consumidor final". */
  patientId: z.string().uuid().nullish(),
  consultationId: z.string().uuid().nullish(),
  docKind: z.enum(DOC_KINDS).nullish(),
  lines: z.array(DraftLineSchema).min(1, 'La factura necesita al menos una línea'),
});

export type CreateDraftInput = z.input<typeof CreateDraftSchema>;

export async function createInvoiceDraft(
  input: CreateDraftInput,
): Promise<Result<{ invoice: InvoiceRow; preview: DraftPreview; url: string }>> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const parsed = CreateDraftSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
    }
    const d = parsed.data;

    let payerId = d.payerId ?? null;
    if (!payerId && d.ownerId) {
      payerId = (await ensurePayerForOwner(supabase, clinicId, d.ownerId, userId)).id;
    }
    if (!payerId) {
      payerId = (await getOrCreateConsumidorFinal(supabase, clinicId, userId)).id;
    }

    const { invoice, preview } = await createDraftInvoice(supabase, clinicId, {
      payerId,
      patientId: d.patientId ?? null,
      consultationId: d.consultationId ?? null,
      docKind: d.docKind ?? undefined,
      lines: d.lines.map((l) => ({
        catalogItemId: l.catalogItemId ?? null,
        description: l.description ?? undefined,
        qty: l.qty,
        unitPriceCents: l.unitPriceCents ?? undefined,
        taxRate: l.taxRate ?? undefined,
        discountCents: l.discountCents ?? undefined,
      })),
      createdBy: userId,
    });
    revalidatePath('/dashboard/facturacion');
    return { ok: true, invoice, preview, url: `/dashboard/facturacion/${invoice.id}` };
  } catch (e) {
    return toError(e);
  }
}

const IssueSchema = z.object({
  invoiceId: z.string().uuid(),
  // La emisión declara la realidad del pago (§2 spec).
  outcome: z.enum(['PAGADO_AHORA', 'PENDIENTE', 'ABONO_PARCIAL']).default('PENDIENTE'),
  method: z.enum(['EFECTIVO', 'TRANSFERENCIA']).nullish(),
  amountCents: z.number().int().positive('El abono debe ser positivo').nullish(),
  reference: z.string().trim().nullish(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)')
    .nullish(),
  followupEnabled: z.boolean().default(true),
  wantsElectronicDelivery: z.boolean().default(false),
});

export type IssueInvoiceInput = z.input<typeof IssueSchema>;

/**
 * EMITE un borrador: consume consecutivo y transmite al proveedor fiscal.
 * IRREVERSIBLE — una factura emitida solo se afecta con nota crédito.
 */
export async function issueInvoiceAction(
  input: IssueInvoiceInput,
): Promise<Result<{ result: IssueResult; url: string }>> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const parsed = IssueSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
    }
    const d = parsed.data;
    const result = await issueInvoice(supabase, clinicId, {
      invoiceId: d.invoiceId,
      outcome: d.outcome,
      method: d.method ?? undefined,
      amountCents: d.amountCents ?? undefined,
      reference: d.reference ?? null,
      dueDate: d.dueDate ?? null,
      followupEnabled: d.followupEnabled,
      wantsElectronicDelivery: d.wantsElectronicDelivery,
      createdBy: userId,
    });
    revalidatePath('/dashboard/facturacion');
    revalidatePath(`/dashboard/facturacion/${d.invoiceId}`);
    return { ok: true, result, url: `/dashboard/facturacion/${d.invoiceId}` };
  } catch (e) {
    return toError(e);
  }
}

export async function discardInvoiceDraft(input: { invoiceId: string }): Promise<Result> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const invoiceId = z.string().uuid().parse(input.invoiceId);
    await discardDraft(supabase, clinicId, invoiceId);
    revalidatePath('/dashboard/facturacion');
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

// ─── Pagos manuales ──────────────────────────────────────────────────────────

const ManualPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  // Métodos que el vet registra a mano; ENLACE llega con la pasarela (Fase 2).
  method: z.enum(MANUAL_PAYMENT_METHODS),
  amountCents: z.number().int().positive('El monto debe ser positivo'),
  reference: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
});

export type ManualPaymentInput = z.input<typeof ManualPaymentSchema>;

export async function registerManualPaymentAction(
  input: ManualPaymentInput,
): Promise<Result<{ newBalanceCents: number; fullyPaid: boolean; collectionStatus: string }>> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const parsed = ManualPaymentSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
    }
    const d = parsed.data;
    const r = await registerManualPayment(supabase, clinicId, {
      invoiceId: d.invoiceId,
      method: d.method,
      amountCents: d.amountCents,
      reference: d.reference ?? null,
      note: d.note ?? null,
      createdBy: userId,
    });
    revalidatePath('/dashboard/facturacion');
    revalidatePath(`/dashboard/facturacion/${d.invoiceId}`);
    return {
      ok: true,
      newBalanceCents: r.newBalanceCents,
      fullyPaid: r.fullyPaid,
      collectionStatus: r.collectionStatus,
    };
  } catch (e) {
    return toError(e);
  }
}

// ─── Enviar por email (botón en el detalle) ──────────────────────────────────
// El destino no tiene email configurado: la action conserva su forma pero
// siempre informa que el canal no está disponible (contrato §5).

const SendEmailSchema = z.object({
  invoiceId: z.string().uuid(),
  to: z.string().email().nullish(),
  message: z.string().trim().nullish(),
});

export type SendInvoiceEmailActionInput = z.input<typeof SendEmailSchema>;

export async function sendInvoiceEmailAction(
  input: SendInvoiceEmailActionInput,
): Promise<Result<{ to: string; publicUrl: string }>> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const parsed = SendEmailSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
    }
    const r = await sendInvoiceByEmail(supabase, clinicId, {
      invoiceId: parsed.data.invoiceId,
      to: parsed.data.to ?? null,
      message: parsed.data.message ?? null,
    });
    if (!r.ok) {
      // Cada motivo tiene una acción distinta del lado del vet: mandarlos todos al mismo mensaje
      // hacía que "el correo del cliente está vacío" se leyera como "falta configurar el correo".
      const MENSAJES: Record<typeof r.reason, string> = {
        email_no_configurado:
          'El correo de la clínica no está configurado. Configuralo en Configuración → Correo, o usá WhatsApp.',
        sin_destinatario:
          'Este pagador no tiene correo registrado. Agregalo en su ficha o escribí una dirección al enviar.',
        factura_no_encontrada: 'No se encontró la factura.',
        envio_fallido: `El servidor de correo rechazó el envío${r.error ? `: ${r.error}` : '.'}`,
      };
      return { ok: false, error: MENSAJES[r.reason] };
    }
    revalidatePath('/dashboard/facturacion');
    revalidatePath(`/dashboard/facturacion/${parsed.data.invoiceId}`);
    return { ok: true, to: r.to, publicUrl: r.publicUrl };
  } catch (e) {
    return toError(e);
  }
}

// ─── Recordatorios de cobranza (Ley 2300) ────────────────────────────────────

export async function toggleInvoiceReminders(input: {
  invoiceId: string;
  paused: boolean;
}): Promise<Result> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const invoiceId = z.string().uuid().parse(input.invoiceId);
    await setInvoiceRemindersPaused(supabase, clinicId, invoiceId, input.paused);
    revalidatePath(`/dashboard/facturacion/${invoiceId}`);
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}


