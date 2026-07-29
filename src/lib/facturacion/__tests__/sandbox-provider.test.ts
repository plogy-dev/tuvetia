import { describe, expect, it } from "vitest";
import {
  SANDBOX_ERROR_DOC,
  SANDBOX_REJECT_DOC,
  SandboxFiscalProvider,
} from "@/lib/facturacion/fiscal/sandbox";
import type { FiscalSubmission } from "@/lib/facturacion/fiscal/types";

function submission(docNumber: string): FiscalSubmission {
  return {
    docKind: "POS",
    fullNumber: "SPOS-1",
    issuedAt: "2026-07-19T10:00:00.000Z",
    emitter: { name: "Vet de prueba", idType: "CC", idNumber: "123456" },
    buyer: { fullName: "Cliente", docType: "CC", docNumber },
    numbering: { prefix: "SPOS", number: 1, fullNumber: "SPOS-1", isSandbox: true },
    payment: { means: "CONTADO", dueDate: null },
    subtotalCents: 10_000_00,
    taxCents: 1_900_00,
    totalCents: 11_900_00,
    lines: [
      {
        description: "Consulta general",
        qty: 1,
        unit: "unidad",
        unitPriceCents: 10_000_00,
        taxRate: 19,
        taxStatus: "GRAVADO",
        taxCents: 1_900_00,
        totalCents: 11_900_00,
      },
    ],
  };
}

describe("SandboxFiscalProvider", () => {
  const provider = new SandboxFiscalProvider();

  it("acepta un documento normal con CUFE sandbox determinista", async () => {
    const a = await provider.submitInvoice(submission("1000001"));
    const b = await provider.submitInvoice(submission("1000001"));
    expect(a.accepted).toBe(true);
    expect(a.status).toBe("ACEPTADO");
    expect(a.cufe).toMatch(/^CUFE-SANDBOX-/);
    // Determinista: misma submission → mismo CUFE (reintentos idempotentes).
    expect(a.cufe).toBe(b.cufe);
  });

  it("rechaza el documento mágico de prueba (camino RECHAZADA)", async () => {
    const r = await provider.submitInvoice(submission(SANDBOX_REJECT_DOC));
    expect(r.accepted).toBe(false);
    expect(r.status).toBe("RECHAZADO");
    expect(r.cufe).toBeNull();
  });

  it("lanza con el documento de falla simulada (camino PENDIENTE/reintento)", async () => {
    await expect(provider.submitInvoice(submission(SANDBOX_ERROR_DOC))).rejects.toThrow();
  });

  it("valida notas crédito", async () => {
    const r = await provider.submitCreditNote({
      fullNumber: "SNC-1",
      invoiceFullNumber: "SPOS-1",
      reason: "Devolución de producto",
      totalCents: 5_000_00,
      emitter: { name: "Vet de prueba", idType: "CC", idNumber: "123456" },
      buyer: { fullName: "Cliente", docType: "CC", docNumber: "1000001" },
    });
    expect(r.accepted).toBe(true);
    expect(r.cufe).toMatch(/^CUFE-SANDBOX-/);
  });
});
