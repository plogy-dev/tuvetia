import { describe, expect, it } from "vitest";
import {
  annulmentRequiresCreditNote,
  canDiscardInvoice,
  isValidCreditNoteReason,
  validateBuyerData,
} from "@/lib/facturacion/domain/dian-rules";

describe("dian-rules: datos mínimos del comprador", () => {
  it("nombre + tipo y número de documento bastan sin entrega digital", () => {
    const r = validateBuyerData(
      { fullName: "David Jiménez", docType: "CC", docNumber: "123456" },
      { wantsElectronicDelivery: false },
    );
    expect(r.valid).toBe(true);
  });

  it("con entrega digital se exige además el correo", () => {
    const r = validateBuyerData(
      { fullName: "David Jiménez", docType: "CC", docNumber: "123456" },
      { wantsElectronicDelivery: true },
    );
    expect(r.valid).toBe(false);
    expect(r.missing.join(" ")).toMatch(/correo/);
  });

  it("HOSTIL: jamás exige dirección, teléfono ni RUT físico", () => {
    const r = validateBuyerData({}, { wantsElectronicDelivery: true });
    const all = r.missing.join(" ").toLowerCase();
    expect(all).not.toMatch(/direcci/);
    expect(all).not.toMatch(/tel[eé]fono/);
    expect(all).not.toMatch(/rut/);
  });
});

describe("dian-rules: anulación y descarte", () => {
  it("solo un borrador puede descartarse", () => {
    expect(canDiscardInvoice("BORRADOR")).toBe(true);
    expect(canDiscardInvoice("VALIDADA")).toBe(false);
    expect(canDiscardInvoice("PENDIENTE_VALIDACION")).toBe(false);
  });

  it("HOSTIL: anular una validada exige nota crédito", () => {
    expect(annulmentRequiresCreditNote("VALIDADA")).toBe(true);
  });

  it("HOSTIL: la falta de pago no es causal de nota crédito", () => {
    expect(isValidCreditNoteReason("cliente no pagó la factura")).toBe(false);
    expect(isValidCreditNoteReason("falta de pago")).toBe(false);
    expect(isValidCreditNoteReason("")).toBe(false);
    expect(isValidCreditNoteReason("error en los valores facturados")).toBe(true);
    expect(isValidCreditNoteReason("devolución del producto")).toBe(true);
  });
});
