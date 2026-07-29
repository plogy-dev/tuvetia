import { describe, expect, it } from "vitest";
import {
  computePurchaseTotalCents,
  movementsForPurchase,
  costPerUseUnitCents,
  validatePurchaseLines,
  type PurchaseLineInput,
} from "@/lib/facturacion/domain/purchases";

const line = (over: Partial<PurchaseLineInput> = {}): PurchaseLineInput => ({
  catalogItemId: "item-1",
  qty: 2,
  unitCostCents: 2800000, // $28.000 por caja
  ...over,
});

describe("computePurchaseTotalCents", () => {
  it("suma qty × costo por línea, redondeando por línea", () => {
    expect(computePurchaseTotalCents([line(), line({ catalogItemId: "item-2", qty: 1.5 })])).toBe(
      2 * 2800000 + Math.round(1.5 * 2800000),
    );
    expect(computePurchaseTotalCents([])).toBe(0);
  });
});

describe("validatePurchaseLines", () => {
  it("acepta líneas válidas", () => {
    expect(validatePurchaseLines([line()])).toBeNull();
  });
  it("rechaza vacío, qty y costo inválidos, fecha rota y duplicados", () => {
    expect(validatePurchaseLines([])).toMatch(/al menos una línea/);
    expect(validatePurchaseLines([line({ qty: 0 })])).toMatch(/Línea 1: cantidad/);
    expect(validatePurchaseLines([line({ unitCostCents: 10.5 })])).toMatch(/Línea 1: costo/);
    expect(validatePurchaseLines([line({ expiresOn: "12/2026" })])).toMatch(/vencimiento/);
    expect(validatePurchaseLines([line(), line()])).toMatch(/repetidas/);
    // Mismo ítem con lotes distintos SÍ se permite.
    expect(validatePurchaseLines([line({ lotCode: "A" }), line({ lotCode: "B" })])).toBeNull();
  });
});

describe("movementsForPurchase", () => {
  it("convierte qty a unidad de uso y omite ítems sin stock", () => {
    const items = new Map([
      ["item-1", { conversionFactor: 50, trackStock: true }], // caja de 50 tabletas
      ["item-2", { conversionFactor: 1, trackStock: false }], // servicio
    ]);
    const moves = movementsForPurchase(
      [line({ qty: 2, lotCode: "L-9" }), line({ catalogItemId: "item-2" })],
      items,
    );
    expect(moves).toEqual([
      { itemId: "item-1", qty: 100, lotCode: "L-9", expiresOn: null },
    ]);
  });
});

describe("costPerUseUnitCents (último costo)", () => {
  it("divide el costo de compra por el factor y redondea", () => {
    expect(costPerUseUnitCents(2800000, 50)).toBe(56000); // $28.000/caja de 50 → $560/tableta
    expect(costPerUseUnitCents(2800000, 1)).toBe(2800000);
    expect(costPerUseUnitCents(1000, 3)).toBe(333);
    expect(costPerUseUnitCents(1000, 0)).toBe(1000); // factor inválido → 1
  });
});
