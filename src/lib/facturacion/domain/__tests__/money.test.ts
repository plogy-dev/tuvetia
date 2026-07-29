import { describe, expect, it } from "vitest";
import {
  computeInvoiceTotals,
  computeLineAmounts,
  formatCOP,
  lineSubtotalCents,
  lineTaxCents,
  pesosToCents,
  roundHalfUp,
  taxableBaseCents,
} from "@/lib/facturacion/domain/money";

describe("money: redondeo", () => {
  it("redondea half-up en positivos y negativos", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(2.4)).toBe(2);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });
});

describe("money: subtotal de línea", () => {
  it("qty fraccionaria (2.5 ml) por precio entero produce entero", () => {
    // 2.5 ml × $1.234,56/ml (123456 centavos) = 308640 centavos exactos
    expect(lineSubtotalCents(2.5, 123456)).toBe(308640);
  });

  it("rechaza precios no enteros (nunca floats en dinero)", () => {
    expect(() => lineSubtotalCents(1, 100.5)).toThrow(/entero/);
  });

  it("rechaza cantidades negativas", () => {
    expect(() => lineSubtotalCents(-1, 100)).toThrow();
  });
});

describe("money: base gravable e IVA", () => {
  it("descuento reduce la base antes del IVA", () => {
    const base = taxableBaseCents(100_000, 10_000);
    expect(base).toBe(90_000);
    expect(lineTaxCents(base, 19)).toBe(17_100);
  });

  it("el descuento no puede exceder el subtotal", () => {
    expect(() => taxableBaseCents(100, 200)).toThrow(/exceder/);
  });

  it("solo acepta tasas 0, 5 y 19", () => {
    expect(lineTaxCents(100_000, 0)).toBe(0);
    expect(lineTaxCents(100_000, 5)).toBe(5_000);
    expect(() => lineTaxCents(100_000, 16)).toThrow(/no soportada/);
  });
});

describe("money: totales de factura", () => {
  it("suma líneas con IVA mixto (consulta exenta + producto al 19%)", () => {
    const consulta = computeLineAmounts({ qty: 1, unitPriceCents: 8_000_000, taxRate: 0 });
    const producto = computeLineAmounts({
      qty: 2,
      unitPriceCents: 1_500_000,
      taxRate: 19,
      discountCents: 200_000,
    });
    const totals = computeInvoiceTotals([consulta, producto]);
    expect(totals.subtotalCents).toBe(8_000_000 + 3_000_000);
    expect(totals.discountCents).toBe(200_000);
    expect(totals.taxCents).toBe(Math.round(2_800_000 * 0.19));
    expect(totals.totalCents).toBe(8_000_000 + 2_800_000 + 532_000);
  });
});

describe("money: formato y conversión", () => {
  it("formatea centavos como COP con separador de miles", () => {
    expect(formatCOP(8_000_000)).toBe("$ 80.000");
    expect(formatCOP(0)).toBe("$ 0");
    expect(formatCOP(-150_000)).toBe("-$ 1.500");
  });

  it("convierte pesos de entrada de usuario a centavos", () => {
    expect(pesosToCents(80_000)).toBe(8_000_000);
  });
});
