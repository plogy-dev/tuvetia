// Lógica PURA de compras a proveedores (0031). Sin Supabase ni Next.
//
// Convenciones de unidades (0021): purchase_items.qty va en unidad de COMPRA
// del ítem; inventory_movements.qty y catalog_items.cost_cents van en unidad
// de USO. La conversión usa conversion_factor (unidades de uso por unidad de
// compra).

export interface PurchaseLineInput {
  catalogItemId: string;
  /** Cantidad en unidad de COMPRA del ítem. */
  qty: number;
  /** Costo por unidad de COMPRA, en centavos. */
  unitCostCents: number;
  lotCode?: string | null;
  /** `YYYY-MM-DD`. */
  expiresOn?: string | null;
}

export interface PurchaseItemInfo {
  conversionFactor: number;
  trackStock: boolean;
}

/** Total de la compra en centavos (por línea: qty × costo unitario, redondeado). */
export function computePurchaseTotalCents(lines: PurchaseLineInput[]): number {
  return lines.reduce((sum, l) => sum + Math.round(l.qty * l.unitCostCents), 0);
}

/** Valida las líneas; devuelve el mensaje del primer problema o null si está bien. */
export function validatePurchaseLines(lines: PurchaseLineInput[]): string | null {
  if (lines.length === 0) return 'La compra necesita al menos una línea';
  for (const [i, l] of lines.entries()) {
    const n = i + 1;
    if (!l.catalogItemId) return `Línea ${n}: falta el producto`;
    if (!Number.isFinite(l.qty) || l.qty <= 0) return `Línea ${n}: cantidad inválida`;
    if (!Number.isInteger(l.unitCostCents) || l.unitCostCents < 0) {
      return `Línea ${n}: costo inválido`;
    }
    if (l.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(l.expiresOn)) {
      return `Línea ${n}: fecha de vencimiento inválida`;
    }
  }
  const seen = new Set<string>();
  for (const l of lines) {
    // Mismo ítem + mismo lote dos veces = probable error de captura.
    const key = `${l.catalogItemId}|${l.lotCode ?? ''}`;
    if (seen.has(key)) return 'Hay líneas repetidas del mismo producto y lote';
    seen.add(key);
  }
  return null;
}

/**
 * Movimientos de inventario a crear al confirmar: qty convertida a unidad de
 * USO. Los ítems sin control de stock (servicios) no generan movimiento.
 */
export function movementsForPurchase(
  lines: PurchaseLineInput[],
  itemsById: Map<string, PurchaseItemInfo>,
): { itemId: string; qty: number; lotCode: string | null; expiresOn: string | null }[] {
  const out: { itemId: string; qty: number; lotCode: string | null; expiresOn: string | null }[] = [];
  for (const l of lines) {
    const item = itemsById.get(l.catalogItemId);
    if (!item || !item.trackStock) continue;
    out.push({
      itemId: l.catalogItemId,
      qty: l.qty * (item.conversionFactor || 1),
      lotCode: l.lotCode ?? null,
      expiresOn: l.expiresOn ?? null,
    });
  }
  return out;
}

/**
 * Regla «último costo»: costo por unidad de USO a partir del costo por unidad
 * de compra de la línea. cost_cents del catálogo va en unidad de uso
 * (computeInventorySummary hace stock × cost_cents).
 */
export function costPerUseUnitCents(unitCostCents: number, conversionFactor: number): number {
  const factor = conversionFactor > 0 ? conversionFactor : 1;
  return Math.round(unitCostCents / factor);
}
