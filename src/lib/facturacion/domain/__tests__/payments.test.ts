import { describe, expect, it } from "vitest";
import { applyPaymentToInvoice } from "@/lib/facturacion/domain/payments";

describe("payments: aplicación de pagos", () => {
  it("pago parcial recalcula saldo y no detiene recordatorios", () => {
    const r = applyPaymentToInvoice({
      invoiceTotalCents: 10_000_000,
      alreadyPaidCents: 0,
      paymentAmountCents: 3_000_000,
    });
    expect(r.newBalanceCents).toBe(7_000_000);
    expect(r.fullyPaid).toBe(false);
    expect(r.stopReminders).toBe(false);
  });

  it("el pago que completa el total detiene recordatorios", () => {
    const r = applyPaymentToInvoice({
      invoiceTotalCents: 10_000_000,
      alreadyPaidCents: 7_000_000,
      paymentAmountCents: 3_000_000,
    });
    expect(r.fullyPaid).toBe(true);
    expect(r.stopReminders).toBe(true);
    expect(r.newBalanceCents).toBe(0);
  });

  it("HOSTIL: rechaza un pago mayor al saldo", () => {
    expect(() =>
      applyPaymentToInvoice({
        invoiceTotalCents: 10_000_000,
        alreadyPaidCents: 9_000_000,
        paymentAmountCents: 2_000_000,
      }),
    ).toThrow(/excede el saldo/);
  });

  it("HOSTIL: rechaza pagos sobre factura sin saldo", () => {
    expect(() =>
      applyPaymentToInvoice({
        invoiceTotalCents: 10_000_000,
        alreadyPaidCents: 10_000_000,
        paymentAmountCents: 1,
      }),
    ).toThrow(/saldo pendiente/);
  });

  it("HOSTIL: rechaza montos cero o negativos", () => {
    expect(() =>
      applyPaymentToInvoice({
        invoiceTotalCents: 10_000_000,
        alreadyPaidCents: 0,
        paymentAmountCents: 0,
      }),
    ).toThrow(/positivo/);
  });

  it("las notas crédito reducen el saldo disponible para pagos", () => {
    expect(() =>
      applyPaymentToInvoice({
        invoiceTotalCents: 10_000_000,
        alreadyPaidCents: 0,
        creditedCents: 8_000_000,
        paymentAmountCents: 3_000_000,
      }),
    ).toThrow(/excede el saldo/);
  });
});
