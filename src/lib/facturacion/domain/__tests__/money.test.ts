import { describe, expect, it } from "vitest";
import {
  computeInvoiceTotals,
  computeLineAmounts,
  formatCOP,
  lineSubtotalCents,
  lineTaxCents,
  pesosToCents,
  prorratearDescuentoGlobal,
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

describe("money: prorrateo del descuento global", () => {
  it("reparte en proporción a la base de cada línea", () => {
    // 30.000 de descuento sobre bases de 60.000 y 40.000 → 18.000 y 12.000.
    expect(prorratearDescuentoGlobal([6_000_000, 4_000_000], 3_000_000)).toEqual([
      1_800_000, 1_200_000,
    ]);
  });

  it("LA SUMA DE LAS PARTES ES EXACTAMENTE EL DESCUENTO PEDIDO", () => {
    // Tres líneas iguales y un descuento que NO divide en tres: 100 centavos / 3 = 33,33…
    // Truncando daría 33+33+33 = 99 y el vet vería un centavo menos del que escribió.
    const partes = prorratearDescuentoGlobal([1000, 1000, 1000], 100);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(100);
    expect(partes).toEqual([34, 33, 33]);
  });

  it("el residuo va a las líneas más cerca de subir, y desempata por orden", () => {
    // Bases 1/6, 2/6, 3/6 de 100: exactos 16,67 · 33,33 · 50 → truncados 16+33+50 = 99.
    // El centavo sobrante es para la fracción mayor (0,67), que es la primera línea.
    expect(prorratearDescuentoGlobal([1000, 2000, 3000], 100)).toEqual([17, 33, 50]);
  });

  it("una línea sin base no absorbe descuento", () => {
    // Una línea regalada (precio 0) no puede recibir descuento: no hay de dónde bajarle.
    expect(prorratearDescuentoGlobal([0, 5000], 500)).toEqual([0, 500]);
  });

  it("sin descuento devuelve ceros, sin tocar nada", () => {
    expect(prorratearDescuentoGlobal([1000, 2000], 0)).toEqual([0, 0]);
  });

  it("rechaza un descuento mayor que el subtotal de la factura", () => {
    expect(() => prorratearDescuentoGlobal([1000, 2000], 3001)).toThrow(/no puede exceder/);
  });

  it("rechaza descuento sobre una factura sin base", () => {
    expect(() => prorratearDescuentoGlobal([0, 0], 100)).toThrow(/No hay base/);
  });

  it("rechaza un descuento negativo", () => {
    expect(() => prorratearDescuentoGlobal([1000], -1)).toThrow(/no puede ser negativo/);
  });

  it("EL DESCUENTO PRORRATEADO RECALCULA EL IVA DE CADA LÍNEA A SU PROPIA TARIFA", () => {
    // Este es el caso que justifica el prorrateo entero, y por eso se prueba de punta a punta.
    //
    // Dos líneas de $50.000: una gravada al 19 % y otra excluida. Descuento global de $20.000.
    // Prorrateado da $10.000 a cada una, así que la gravada tributa sobre 40.000 y no sobre 50.000.
    const bases = [5_000_000, 5_000_000];
    const partes = prorratearDescuentoGlobal(bases, 2_000_000);

    const gravada = computeLineAmounts({
      qty: 1,
      unitPriceCents: 5_000_000,
      taxRate: 19,
      discountCents: partes[0],
    });
    const excluida = computeLineAmounts({
      qty: 1,
      unitPriceCents: 5_000_000,
      taxRate: 0,
      discountCents: partes[1],
    });

    // IVA sobre 40.000, no sobre 50.000: 760.000 centavos y no 950.000.
    expect(gravada.taxCents).toBe(760_000);
    expect(excluida.taxCents).toBe(0);

    const totales = computeInvoiceTotals([gravada, excluida]);
    expect(totales.discountCents).toBe(2_000_000);
    // La factura cuadra sola: (subtotal − descuento) + IVA = total.
    expect(totales.subtotalCents - totales.discountCents + totales.taxCents).toBe(
      totales.totalCents,
    );
  });
});
