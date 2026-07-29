import { describe, expect, it } from "vitest";
import {
  computeFinanceSummary,
  financeCsv,
  monthKeyBogota,
} from "@/lib/facturacion/domain/finance";

describe("monthKeyBogota", () => {
  it("un pago a las 23:30 UTC del día 1 sigue en el mes anterior en Bogotá si aplica", () => {
    // 2026-07-01T02:30Z = 2026-06-30 21:30 en Bogotá (UTC-5) → junio.
    expect(monthKeyBogota("2026-07-01T02:30:00Z")).toBe("2026-06");
    // 2026-07-01T12:00Z = 07:00 en Bogotá → julio.
    expect(monthKeyBogota("2026-07-01T12:00:00Z")).toBe("2026-07");
  });
});

describe("computeFinanceSummary", () => {
  it("suma ingresos/egresos, neto y agrupa por mes y categoría", () => {
    const s = computeFinanceSummary(
      [
        { amountCents: 6000000, at: "2026-06-15T15:00:00Z" }, // $60.000 junio
        { amountCents: 4000000, at: "2026-07-02T15:00:00Z" }, // $40.000 julio
      ],
      [
        { amountCents: 2500000, date: "2026-07-05", category: "ARRIENDO" },
        { amountCents: 1000000, date: "2026-07-10", category: "COMPRA_INVENTARIO" },
        { amountCents: 3000000, date: "2026-06-20", category: "ARRIENDO" },
      ],
    );
    expect(s.incomeCents).toBe(10000000);
    expect(s.expenseCents).toBe(6500000);
    expect(s.netCents).toBe(3500000);
    expect(s.byMonth).toEqual([
      { month: "2026-06", incomeCents: 6000000, expenseCents: 3000000 },
      { month: "2026-07", incomeCents: 4000000, expenseCents: 3500000 },
    ]);
    expect(s.byCategory).toEqual([
      { category: "ARRIENDO", amountCents: 5500000 },
      { category: "COMPRA_INVENTARIO", amountCents: 1000000 },
    ]);
  });

  it("vacío → todo en cero", () => {
    const s = computeFinanceSummary([], []);
    expect(s.netCents).toBe(0);
    expect(s.byMonth).toEqual([]);
    expect(s.byCategory).toEqual([]);
  });
});

describe("financeCsv", () => {
  it("egresos en negativo, sin separador de miles, escapando ; y comillas", () => {
    const csv = financeCsv([
      { date: "2026-07-05", kind: "INGRESO", concept: "Pago factura POS-12", method: "NEQUI", amountCents: 4500000 },
      { date: "2026-07-06", kind: "EGRESO", concept: 'Arriendo; local "centro"', method: "TRANSFERENCIA", amountCents: 2500000 },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Fecha;Tipo;Concepto;Método;Monto (COP)");
    expect(lines[1]).toBe("2026-07-05;INGRESO;Pago factura POS-12;NEQUI;45000");
    expect(lines[2]).toBe('2026-07-06;EGRESO;"Arriendo; local ""centro""";TRANSFERENCIA;-25000');
  });
});
