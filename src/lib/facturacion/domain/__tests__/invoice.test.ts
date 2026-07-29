import { describe, expect, it } from "vitest";
import { buildLineSnapshot, maxDiscountPctForRole, validateDraftInvoice } from "@/lib/facturacion/domain/invoice";

const buyer = { fullName: "Laura Pérez", docType: "CC", docNumber: "52123456" };

describe("invoice: fotografía histórica de líneas", () => {
  it("la línea copia precio, impuesto y descripción al construirse", () => {
    const line = buildLineSnapshot({
      catalogItemId: "item1",
      description: "Amoxicilina 250mg",
      qty: 2,
      unit: "tableta",
      unitPriceCents: 350_000,
      taxRate: 19,
    });
    expect(line.unitPriceCents).toBe(350_000);
    expect(line.subtotalCents).toBe(700_000);
    expect(line.taxCents).toBe(133_000);
    expect(line.totalCents).toBe(833_000);
  });

  it("rechaza líneas sin descripción o con cantidad inválida", () => {
    expect(() =>
      buildLineSnapshot({ description: " ", qty: 1, unit: "u", unitPriceCents: 100, taxRate: 0 }),
    ).toThrow(/descripción/);
    expect(() =>
      buildLineSnapshot({ description: "x", qty: 0, unit: "u", unitPriceCents: 100, taxRate: 0 }),
    ).toThrow(/mayor que cero/);
  });
});

describe("invoice: validaciones de borrador (§7.5)", () => {
  const baseLine = {
    description: "Consulta general",
    qty: 1,
    unit: "servicio",
    unitPriceCents: 8_000_000,
    taxRate: 0,
  };

  it("borrador limpio no produce avisos ni bloqueos", () => {
    const r = validateDraftInvoice({
      lines: [baseLine],
      buyer,
      wantsElectronicDelivery: false,
      role: "RECEPCION",
    });
    expect(r.warnings).toHaveLength(0);
    expect(r.blockers).toHaveLength(0);
  });

  it("sin líneas es bloqueo", () => {
    const r = validateDraftInvoice({
      lines: [],
      buyer,
      wantsElectronicDelivery: false,
      role: "ADMIN",
    });
    expect(r.blockers.some((b) => b.code === "SIN_LINEAS")).toBe(true);
  });

  it("existencia insuficiente advierte por defecto y bloquea si la clínica lo pide", () => {
    const line = { ...baseLine, description: "Vacuna", trackStock: true, stock: 0, qty: 2 };
    const warn = validateDraftInvoice({
      lines: [line],
      buyer,
      wantsElectronicDelivery: false,
      role: "ADMIN",
    });
    expect(warn.warnings.some((w) => w.code === "EXISTENCIA_INSUFICIENTE")).toBe(true);

    const block = validateDraftInvoice({
      lines: [line],
      buyer,
      wantsElectronicDelivery: false,
      role: "ADMIN",
      blockOnInsufficientStock: true,
    });
    expect(block.blockers.some((b) => b.code === "EXISTENCIA_INSUFICIENTE")).toBe(true);
  });

  it("precio bajo costo y lote por vencer son advertencias, no bloqueos", () => {
    const r = validateDraftInvoice({
      lines: [{ ...baseLine, costCents: 9_000_000, nearExpiry: true }],
      buyer,
      wantsElectronicDelivery: false,
      role: "ADMIN",
    });
    expect(r.warnings.map((w) => w.code).sort()).toEqual([
      "PRECIO_BAJO_COSTO",
      "PRODUCTO_POR_VENCER",
    ]);
    expect(r.blockers).toHaveLength(0);
  });

  it("impuesto no configurado bloquea", () => {
    const r = validateDraftInvoice({
      lines: [{ ...baseLine, taxRate: 16 }],
      buyer,
      wantsElectronicDelivery: false,
      role: "ADMIN",
    });
    expect(r.blockers.some((b) => b.code === "IMPUESTO_INVALIDO")).toBe(true);
  });

  it("cliente sin datos fiscales bloquea la emisión", () => {
    const r = validateDraftInvoice({
      lines: [baseLine],
      buyer: { fullName: "Pepe" },
      wantsElectronicDelivery: false,
      role: "ADMIN",
    });
    expect(r.blockers.some((b) => b.code === "DATOS_FISCALES_INCOMPLETOS")).toBe(true);
  });

  it("HOSTIL: descuento del 30% bloquea a RECEPCION pero no a ADMIN", () => {
    const line = { ...baseLine, discountCents: 2_400_000 }; // 30% de 8.000.000
    const recep = validateDraftInvoice({
      lines: [line],
      buyer,
      wantsElectronicDelivery: false,
      role: "RECEPCION",
    });
    expect(recep.blockers.some((b) => b.code === "DESCUENTO_EXCEDE_ROL")).toBe(true);

    const admin = validateDraftInvoice({
      lines: [line],
      buyer,
      wantsElectronicDelivery: false,
      role: "ADMIN",
    });
    expect(admin.blockers).toHaveLength(0);
  });

  it("umbral por rol: 20% general, sin límite para ADMIN", () => {
    expect(maxDiscountPctForRole("RECEPCION")).toBe(20);
    expect(maxDiscountPctForRole("VETERINARIO")).toBe(20);
    expect(maxDiscountPctForRole("ADMIN")).toBe(100);
  });
});
