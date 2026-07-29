// Inventario por MOVIMIENTOS: la existencia nunca se sobrescribe, se deriva
// como la suma de movimientos firmados (positivo entra, negativo sale).
// Unidades veterinarias: se compra en purchaseUnit (frasco), se usa/vende en
// useUnit (ml); conversionFactor = useUnits por purchaseUnit.

import type { MovementType } from "./types";

export interface MovementLike {
  qty: number; // en useUnit; positivo = entrada, negativo = salida
  type: MovementType;
}

const INBOUND: MovementType[] = ["CARGA_INICIAL", "ENTRADA_COMPRA", "DEVOLUCION"];
const OUTBOUND: MovementType[] = [
  "SALIDA_VENTA",
  "SALIDA_APLICACION",
  "CONSUMO_INTERNO",
  "VENCIMIENTO",
  "PERDIDA",
];
// AJUSTE puede llevar cualquier signo.

export function validateMovementSign(m: MovementLike): void {
  if (m.qty === 0) throw new Error("Un movimiento no puede tener cantidad cero");
  if (INBOUND.includes(m.type) && m.qty < 0) {
    throw new Error(`El movimiento ${m.type} debe ser positivo`);
  }
  if (OUTBOUND.includes(m.type) && m.qty > 0) {
    throw new Error(`El movimiento ${m.type} debe ser negativo`);
  }
}

/** Existencia actual (en useUnit) = suma de movimientos. */
export function stockFromMovements(movements: MovementLike[]): number {
  for (const m of movements) validateMovementSign(m);
  const sum = movements.reduce((acc, m) => acc + m.qty, 0);
  // evita ruido de flotantes en cantidades fraccionarias (0.1+0.2)
  return Math.round(sum * 1e6) / 1e6;
}

export interface ItemUnits {
  purchaseUnit: string;
  useUnit: string;
  conversionFactor: number; // useUnits por 1 purchaseUnit
}

/** Compra de N unidades de compra → entrada en unidades de uso. */
export function purchaseMovementQty(item: ItemUnits, purchaseQty: number): number {
  if (purchaseQty <= 0) throw new Error("La cantidad comprada debe ser positiva");
  if (item.conversionFactor <= 0) throw new Error("conversionFactor debe ser positivo");
  return purchaseQty * item.conversionFactor;
}

/** Venta/aplicación de N unidades de uso → salida (negativa) en unidades de uso. */
export function saleMovementQty(useQty: number): number {
  if (useQty <= 0) throw new Error("La cantidad vendida/aplicada debe ser positiva");
  return -useQty;
}

export interface AvailabilityCheck {
  sufficient: boolean;
  stock: number;
  requested: number;
  deficit: number; // > 0 cuando falta existencia
}

export function checkAvailability(stock: number, requestedUseQty: number): AvailabilityCheck {
  const deficit = Math.max(0, requestedUseQty - stock);
  return { sufficient: deficit === 0, stock, requested: requestedUseQty, deficit };
}

/** ¿El lote vence dentro de la ventana dada? (now inyectado para testear). */
export function lotNearExpiry(expiresAt: Date | null, now: Date, windowDays = 30): boolean {
  if (!expiresAt) return false;
  const ms = expiresAt.getTime() - now.getTime();
  return ms <= windowDays * 24 * 60 * 60 * 1000;
}

// ─── KPIs del panel de inventario (F4) ───────────────────────────────────────

export interface InventoryItemLike {
  id: string;
  active: boolean;
  track_stock: boolean;
  min_stock: number | null;
  cost_cents: number | null;
}

export interface InventorySummary {
  /** Ítems activos (todos los tipos). */
  activeItems: number;
  /** Ítems activos con control de stock. */
  trackedItems: number;
  /** Valor a costo = Σ existencia × cost_cents (solo activos con stock y costo). */
  valueAtCostCents: number;
  /** Activos con stock bajo el mínimo definido. */
  lowStock: number;
  /** Activos con existencia ≤ 0. */
  outOfStock: number;
  /** Activos con al menos un lote por vencer. */
  nearExpiry: number;
}

/**
 * Resumen del inventario a partir de los ítems + el mapa de existencias + el set
 * de ítems con lote por vencer. Puro y determinista (todo se inyecta). Solo
 * cuenta ítems ACTIVOS; el valor a costo ignora ítems sin costo o sin stock.
 */
export function computeInventorySummary(
  items: InventoryItemLike[],
  stockMap: Map<string, number>,
  nearExpiryIds: Set<string>,
): InventorySummary {
  const summary: InventorySummary = {
    activeItems: 0,
    trackedItems: 0,
    valueAtCostCents: 0,
    lowStock: 0,
    outOfStock: 0,
    nearExpiry: 0,
  };
  for (const it of items) {
    if (!it.active) continue;
    summary.activeItems += 1;
    if (nearExpiryIds.has(it.id)) summary.nearExpiry += 1;
    if (!it.track_stock) continue;
    summary.trackedItems += 1;
    const stock = stockMap.get(it.id) ?? 0;
    if (stock <= 0) summary.outOfStock += 1;
    if (it.min_stock !== null && stock < Number(it.min_stock)) summary.lowStock += 1;
    if (it.cost_cents && stock > 0) {
      summary.valueAtCostCents += Math.round(stock * it.cost_cents);
    }
  }
  return summary;
}
