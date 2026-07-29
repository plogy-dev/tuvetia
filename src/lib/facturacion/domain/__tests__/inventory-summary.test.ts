import { describe, expect, it } from 'vitest';
import { computeInventorySummary, type InventoryItemLike } from '../inventory';
import { DEFAULT_VET_CATEGORIES } from '../categories';

function item(p: Partial<InventoryItemLike> & { id: string }): InventoryItemLike {
  return {
    active: true,
    track_stock: false,
    min_stock: null,
    cost_cents: null,
    ...p,
  };
}

describe('computeInventorySummary (KPIs del panel)', () => {
  it('cuenta solo ítems activos', () => {
    const items = [item({ id: 'a' }), item({ id: 'b', active: false }), item({ id: 'c' })];
    const s = computeInventorySummary(items, new Map(), new Set());
    expect(s.activeItems).toBe(2);
  });

  it('valor a costo = Σ existencia × cost_cents (solo activos con stock y costo)', () => {
    const items = [
      item({ id: 'a', track_stock: true, cost_cents: 1000 }), // 5 × 1000 = 5000
      item({ id: 'b', track_stock: true, cost_cents: 250 }), //  10 × 250 = 2500
      item({ id: 'c', track_stock: true, cost_cents: null }), // sin costo → ignora
      item({ id: 'd', track_stock: true, cost_cents: 999, active: false }), // inactivo → ignora
    ];
    const stock = new Map([['a', 5], ['b', 10], ['c', 3], ['d', 100]]);
    const s = computeInventorySummary(items, stock, new Set());
    expect(s.valueAtCostCents).toBe(7500);
  });

  it('agotados: stock ≤ 0 entre los que controlan stock', () => {
    const items = [
      item({ id: 'a', track_stock: true }), // stock 0 → agotado
      item({ id: 'b', track_stock: true }), // stock 5
      item({ id: 'c', track_stock: false }), // sin control → no cuenta
    ];
    const s = computeInventorySummary(items, new Map([['b', 5]]), new Set());
    expect(s.outOfStock).toBe(1);
    expect(s.trackedItems).toBe(2);
  });

  it('bajo mínimo: stock < min_stock', () => {
    const items = [
      item({ id: 'a', track_stock: true, min_stock: 3 }), // stock 1 < 3 → bajo
      item({ id: 'b', track_stock: true, min_stock: 3 }), // stock 5 ≥ 3 → ok
      item({ id: 'c', track_stock: true, min_stock: null }), // sin mínimo → no cuenta
    ];
    const s = computeInventorySummary(items, new Map([['a', 1], ['b', 5]]), new Set());
    expect(s.lowStock).toBe(1);
  });

  it('por vencer: cuenta ítems activos en el set de vencimiento', () => {
    const items = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c', active: false })];
    const s = computeInventorySummary(items, new Map(), new Set(['a', 'c']));
    expect(s.nearExpiry).toBe(1); // 'c' está inactivo → no cuenta
  });

  it('un ítem agotado también puede estar bajo mínimo', () => {
    const s = computeInventorySummary(
      [item({ id: 'a', track_stock: true, min_stock: 2 })],
      new Map([['a', 0]]),
      new Set(),
    );
    expect(s.outOfStock).toBe(1);
    expect(s.lowStock).toBe(1);
  });
});

describe('DEFAULT_VET_CATEGORIES', () => {
  it('no está vacío y no tiene duplicados', () => {
    expect(DEFAULT_VET_CATEGORIES.length).toBeGreaterThan(5);
    expect(new Set(DEFAULT_VET_CATEGORIES).size).toBe(DEFAULT_VET_CATEGORIES.length);
  });

  it('no incluye «Sin categoría» (esa es la default del backfill)', () => {
    expect(DEFAULT_VET_CATEGORIES.map((c) => c.toLowerCase())).not.toContain('sin categoría');
  });
});
