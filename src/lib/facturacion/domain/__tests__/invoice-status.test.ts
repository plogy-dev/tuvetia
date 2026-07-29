import { describe, expect, it } from "vitest";
import { deriveFollowupStatus, deriveStatus } from "@/lib/facturacion/domain/invoice-status";
import type { InvoiceEventLike } from "@/lib/facturacion/domain/types";

const T = (iso: string) => new Date(iso);
const ev = (type: InvoiceEventLike["type"], at: string, payload?: unknown): InvoiceEventLike => ({
  type,
  createdAt: T(at),
  payload,
});

const CTX = { now: T("2026-07-17T12:00:00"), totalCents: 10_000_000, dueDate: null };

describe("invoice-status: dimensión fiscal", () => {
  it("sin eventos es BORRADOR", () => {
    const s = deriveStatus([], CTX);
    expect(s.fiscal).toBe("BORRADOR");
    expect(s.collection).toBe("PENDIENTE");
    expect(s.delivery).toBe("NO_ENVIADA");
  });

  it("emitida → pendiente de validación → validada", () => {
    const s = deriveStatus(
      [ev("ISSUED", "2026-07-01T10:00:00"), ev("FISCAL_VALIDATED", "2026-07-01T10:01:00")],
      CTX,
    );
    expect(s.fiscal).toBe("VALIDADA");
  });

  it("rechazo del proveedor fiscal → RECHAZADA", () => {
    const s = deriveStatus(
      [ev("ISSUED", "2026-07-01T10:00:00"), ev("FISCAL_REJECTED", "2026-07-01T10:01:00")],
      CTX,
    );
    expect(s.fiscal).toBe("RECHAZADA");
  });

  it("nota crédito → AFECTADA_POR_NOTA_CREDITO", () => {
    const s = deriveStatus(
      [
        ev("ISSUED", "2026-07-01T10:00:00"),
        ev("FISCAL_VALIDATED", "2026-07-01T10:01:00"),
        ev("CREDIT_NOTE_APPLIED", "2026-07-02T10:00:00", { amountCents: 10_000_000 }),
      ],
      CTX,
    );
    expect(s.fiscal).toBe("AFECTADA_POR_NOTA_CREDITO");
  });
});

describe("invoice-status: dimensión de recaudo", () => {
  it("pago parcial → PARCIALMENTE_PAGADA con saldo correcto", () => {
    const s = deriveStatus(
      [ev("PAYMENT_APPLIED", "2026-07-02T10:00:00", { amountCents: 4_000_000 })],
      CTX,
    );
    expect(s.collection).toBe("PARCIALMENTE_PAGADA");
    expect(s.paidCents).toBe(4_000_000);
    expect(s.balanceCents).toBe(6_000_000);
  });

  it("varios pagos completan → PAGADA y recordatorios detenidos", () => {
    const s = deriveStatus(
      [
        ev("PAYMENT_APPLIED", "2026-07-02T10:00:00", { amountCents: 4_000_000 }),
        ev("PAYMENT_APPLIED", "2026-07-03T10:00:00", { amountCents: 6_000_000 }),
      ],
      CTX,
    );
    expect(s.collection).toBe("PAGADA");
    expect(s.balanceCents).toBe(0);
    expect(s.remindersPaused).toBe(true);
  });

  it("vencida cuando pasó la fecha y hay saldo", () => {
    const s = deriveStatus([], { ...CTX, dueDate: T("2026-07-10T00:00:00") });
    expect(s.collection).toBe("VENCIDA");
  });

  it("la disputa domina sobre vencida y detiene recordatorios", () => {
    const s = deriveStatus([ev("DISPUTE_OPENED", "2026-07-11T10:00:00")], {
      ...CTX,
      dueDate: T("2026-07-10T00:00:00"),
    });
    expect(s.collection).toBe("EN_DISPUTA");
    expect(s.remindersPaused).toBe(true);
  });

  it("cerrar la disputa restaura el estado derivado", () => {
    const s = deriveStatus(
      [ev("DISPUTE_OPENED", "2026-07-11T10:00:00"), ev("DISPUTE_CLOSED", "2026-07-12T10:00:00")],
      { ...CTX, dueDate: T("2026-07-10T00:00:00") },
    );
    expect(s.collection).toBe("VENCIDA");
  });

  it("promesa de pago vigente → EN_PROMESA_DE_PAGO y pausa recordatorios (§3 spec)", () => {
    const s = deriveStatus(
      [ev("PROMISE_TO_PAY", "2026-07-15T10:00:00", { until: "2026-07-25T00:00:00" })],
      CTX,
    );
    expect(s.collection).toBe("EN_PROMESA_DE_PAGO");
    expect(s.remindersPaused).toBe(true);
    expect(s.promiseActiveUntil).toEqual(new Date("2026-07-25T00:00:00"));
  });

  it("la promesa vigente domina sobre VENCIDA (no se cobra durante la promesa)", () => {
    const s = deriveStatus(
      [ev("PROMISE_TO_PAY", "2026-07-15T10:00:00", { until: "2026-07-25T00:00:00" })],
      { ...CTX, dueDate: T("2026-07-10T00:00:00") },
    );
    expect(s.collection).toBe("EN_PROMESA_DE_PAGO");
  });

  it("promesa expirada sin pago vuelve a VENCIDA", () => {
    const s = deriveStatus(
      [ev("PROMISE_TO_PAY", "2026-07-01T10:00:00", { until: "2026-07-05T00:00:00" })],
      { ...CTX, dueDate: T("2026-07-10T00:00:00") },
    );
    expect(s.collection).toBe("VENCIDA");
    expect(s.promiseActiveUntil).toBeNull();
  });

  it("promesa de pago expirada ya no pausa", () => {
    const s = deriveStatus(
      [ev("PROMISE_TO_PAY", "2026-07-01T10:00:00", { until: "2026-07-05T00:00:00" })],
      CTX,
    );
    expect(s.remindersPaused).toBe(false);
  });

  it("castigada domina todo", () => {
    const s = deriveStatus(
      [
        ev("PAYMENT_APPLIED", "2026-07-02T10:00:00", { amountCents: 1_000_000 }),
        ev("WRITTEN_OFF", "2026-07-16T10:00:00"),
      ],
      CTX,
    );
    expect(s.collection).toBe("CASTIGADA");
  });
});

describe("invoice-status: dimensión de entrega", () => {
  it("enviada → entregada", () => {
    const s = deriveStatus(
      [ev("SENT", "2026-07-01T10:00:00"), ev("DELIVERED", "2026-07-01T10:05:00")],
      CTX,
    );
    expect(s.delivery).toBe("ENTREGADA");
  });

  it("fallo de entrega", () => {
    const s = deriveStatus(
      [ev("SENT", "2026-07-01T10:00:00"), ev("DELIVERY_FAILED", "2026-07-01T10:05:00")],
      CTX,
    );
    expect(s.delivery).toBe("FALLIDA");
  });
});

describe("invoice-status: dimensión de entrega — EN_COLA (F1)", () => {
  it("QUEUED encola cuando no se ha enviado", () => {
    const s = deriveStatus([ev("QUEUED", "2026-07-01T10:00:00")], CTX);
    expect(s.delivery).toBe("EN_COLA");
  });

  it("QUEUED tras un fallo re-encola; pero no retrocede un envío exitoso", () => {
    const failed = deriveStatus(
      [
        ev("SENT", "2026-07-01T10:00:00"),
        ev("DELIVERY_FAILED", "2026-07-01T10:05:00"),
        ev("QUEUED", "2026-07-01T11:00:00"),
      ],
      CTX,
    );
    expect(failed.delivery).toBe("EN_COLA");

    const delivered = deriveStatus(
      [
        ev("SENT", "2026-07-01T10:00:00"),
        ev("DELIVERED", "2026-07-01T10:05:00"),
        ev("QUEUED", "2026-07-01T11:00:00"),
      ],
      CTX,
    );
    expect(delivered.delivery).toBe("ENTREGADA");
  });
});

describe("invoice-status: 4ª dimensión — seguimiento de cartera (F1)", () => {
  const base = {
    followupEnabled: true,
    followupRequired: true,
    derived: { collection: "PENDIENTE" as const, balanceCents: 5_000_000, remindersPaused: false },
  };

  it("pagado al emitir u opt-out → NO_REQUERIDO", () => {
    expect(deriveFollowupStatus({ ...base, followupRequired: false })).toBe("NO_REQUERIDO");
    expect(deriveFollowupStatus({ ...base, followupEnabled: false })).toBe("NO_REQUERIDO");
  });

  it("pendiente sin contactos → PROGRAMADO; con contacto → ACTIVO", () => {
    expect(deriveFollowupStatus(base)).toBe("PROGRAMADO");
    expect(deriveFollowupStatus({ ...base, anyReminderSent: true })).toBe("ACTIVO");
  });

  it("promesa/disputa/pausa manual → PAUSADO", () => {
    expect(
      deriveFollowupStatus({
        ...base,
        derived: { ...base.derived, remindersPaused: true },
      }),
    ).toBe("PAUSADO");
  });

  it("saldo en cero → COMPLETADO (habiendo tenido seguimiento)", () => {
    expect(
      deriveFollowupStatus({
        ...base,
        derived: { collection: "PAGADA", balanceCents: 0, remindersPaused: true },
      }),
    ).toBe("COMPLETADO");
  });

  it("sin canales autorizados o castigada → CANCELADO", () => {
    expect(deriveFollowupStatus({ ...base, allChannelsRevoked: true })).toBe("CANCELADO");
    expect(
      deriveFollowupStatus({
        ...base,
        derived: { collection: "CASTIGADA", balanceCents: 5_000_000, remindersPaused: true },
      }),
    ).toBe("CANCELADO");
  });

  it("HOSTIL: tarea humana abierta domina sobre todo lo demás", () => {
    expect(
      deriveFollowupStatus({
        ...base,
        hasOpenHumanTask: true,
        derived: { ...base.derived, remindersPaused: true },
      }),
    ).toBe("REQUIERE_ATENCION_HUMANA");
  });

  it("HOSTIL: emitir/enviar jamás produce PAGADA — solo eventos de pago mueven recaudo", () => {
    const s = deriveStatus(
      [
        ev("ISSUED", "2026-07-01T10:00:00"),
        ev("FISCAL_VALIDATED", "2026-07-01T10:01:00"),
        ev("SENT", "2026-07-01T10:02:00"),
        ev("DELIVERED", "2026-07-01T10:03:00"),
      ],
      CTX,
    );
    expect(s.collection).toBe("PENDIENTE");
    expect(s.paidCents).toBe(0);
  });
});
