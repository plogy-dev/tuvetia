import { describe, expect, it } from "vitest";
import { POS_THRESHOLD_UVT, checkPosThreshold } from "@/lib/facturacion/domain/dian-rules";
import { DOC_KINDS, TAX_STATUSES } from "@/lib/facturacion/domain/types";

// UVT 2026 = $52.374 → en centavos
const UVT_2026_CENTS = 5_237_400;

describe("checkPosThreshold (regla 5 UVT, art. 616-1 ET)", () => {
  it("no advierte cuando la operación está por debajo de 5 UVT", () => {
    const r = checkPosThreshold(20_000_000, UVT_2026_CENTS); // $200.000
    expect(r.exceeds).toBe(false);
    expect(r.thresholdCents).toBe(POS_THRESHOLD_UVT * UVT_2026_CENTS);
    expect(r.message).toBeUndefined();
  });

  it("no advierte cuando la operación es exactamente 5 UVT (el umbral es 'supera')", () => {
    const r = checkPosThreshold(5 * UVT_2026_CENTS, UVT_2026_CENTS);
    expect(r.exceeds).toBe(false);
  });

  it("advierte cuando la operación supera 5 UVT", () => {
    const r = checkPosThreshold(5 * UVT_2026_CENTS + 1, UVT_2026_CENTS);
    expect(r.exceeds).toBe(true);
    expect(r.message).toMatch(/factura electrónica de venta/);
  });

  it("rechaza un valor de UVT no positivo", () => {
    expect(() => checkPosThreshold(1000, 0)).toThrow();
    expect(() => checkPosThreshold(1000, -1)).toThrow();
  });
});

describe("uniones fiscales nuevas", () => {
  it("DOC_KINDS cubre factura de venta y POS electrónico", () => {
    expect(DOC_KINDS).toEqual(["FACTURA_VENTA", "POS"]);
  });

  it("TAX_STATUSES distingue gravado, exento y excluido", () => {
    expect(TAX_STATUSES).toEqual(["GRAVADO", "EXENTO", "EXCLUIDO"]);
  });
});
