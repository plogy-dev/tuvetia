import { describe, expect, it } from "vitest";
import {
  checkAvailability,
  lotNearExpiry,
  purchaseMovementQty,
  saleMovementQty,
  stockFromMovements,
  validateMovementSign,
} from "@/lib/facturacion/domain/inventory";

describe("inventory: unidades veterinarias", () => {
  const frasco = { purchaseUnit: "frasco", useUnit: "ml", conversionFactor: 100 };

  it("comprar 1 frasco de 100 ml entra 100 ml", () => {
    expect(purchaseMovementQty(frasco, 1)).toBe(100);
  });

  it("aplicar 2 ml descuenta 2 ml, no un frasco", () => {
    expect(saleMovementQty(2)).toBe(-2);
  });

  it("existencia = suma de movimientos (frasco entra, dosis salen)", () => {
    const movements = [
      { qty: purchaseMovementQty(frasco, 1), type: "ENTRADA_COMPRA" as const },
      { qty: saleMovementQty(2), type: "SALIDA_APLICACION" as const },
      { qty: saleMovementQty(2.5), type: "SALIDA_APLICACION" as const },
    ];
    expect(stockFromMovements(movements)).toBe(95.5);
  });
});

describe("inventory: signos por tipo de movimiento", () => {
  it("rechaza salidas positivas y entradas negativas", () => {
    expect(() => validateMovementSign({ qty: 5, type: "SALIDA_VENTA" })).toThrow(/negativo/);
    expect(() => validateMovementSign({ qty: -5, type: "ENTRADA_COMPRA" })).toThrow(/positivo/);
  });

  it("rechaza movimientos de cantidad cero", () => {
    expect(() => validateMovementSign({ qty: 0, type: "AJUSTE" })).toThrow(/cero/);
  });

  it("el ajuste admite cualquier signo", () => {
    expect(() => validateMovementSign({ qty: -3, type: "AJUSTE" })).not.toThrow();
    expect(() => validateMovementSign({ qty: 3, type: "AJUSTE" })).not.toThrow();
  });
});

describe("inventory: disponibilidad", () => {
  it("detecta existencia insuficiente con el déficit exacto", () => {
    const check = checkAvailability(3, 5);
    expect(check.sufficient).toBe(false);
    expect(check.deficit).toBe(2);
  });

  it("acepta cuando alcanza", () => {
    expect(checkAvailability(10, 5).sufficient).toBe(true);
  });
});

describe("inventory: vencimiento de lotes", () => {
  const now = new Date(2026, 6, 17);

  it("lote que vence en 10 días está por vencer (ventana 30)", () => {
    expect(lotNearExpiry(new Date(2026, 6, 27), now)).toBe(true);
  });

  it("lote que vence en 60 días no alerta", () => {
    expect(lotNearExpiry(new Date(2026, 8, 15), now)).toBe(false);
  });

  it("sin fecha de vencimiento no alerta", () => {
    expect(lotNearExpiry(null, now)).toBe(false);
  });
});
