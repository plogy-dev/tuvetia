// Aplicación y conciliación de pagos: funciones puras.
// Reglas: un pago no puede aplicarse por encima del saldo de la factura;
// una factura puede recibir varios pagos; aplicar un pago recalcula saldo y
// (si queda en cero) detiene los recordatorios.

import { assertMoneyInt } from "./money";

export interface ApplicationResult {
  appliedCents: number;
  newPaidCents: number;
  newBalanceCents: number;
  fullyPaid: boolean;
  stopReminders: boolean;
}

export function applyPaymentToInvoice(input: {
  invoiceTotalCents: number;
  alreadyPaidCents: number;
  creditedCents?: number;
  paymentAmountCents: number;
}): ApplicationResult {
  const { invoiceTotalCents, alreadyPaidCents, paymentAmountCents } = input;
  const creditedCents = input.creditedCents ?? 0;
  assertMoneyInt(invoiceTotalCents, "invoiceTotalCents");
  assertMoneyInt(alreadyPaidCents, "alreadyPaidCents");
  assertMoneyInt(paymentAmountCents, "paymentAmountCents");
  assertMoneyInt(creditedCents, "creditedCents");

  if (paymentAmountCents <= 0) {
    throw new Error("El monto del pago debe ser positivo");
  }
  const balance = invoiceTotalCents - alreadyPaidCents - creditedCents;
  if (balance <= 0) {
    throw new Error("La factura no tiene saldo pendiente");
  }
  if (paymentAmountCents > balance) {
    throw new Error(
      `El pago (${paymentAmountCents}) excede el saldo de la factura (${balance}). ` +
        "Aplique un monto parcial o registre el excedente como saldo a favor.",
    );
  }

  const newPaidCents = alreadyPaidCents + paymentAmountCents;
  const newBalanceCents = invoiceTotalCents - newPaidCents - creditedCents;
  const fullyPaid = newBalanceCents === 0;
  return {
    appliedCents: paymentAmountCents,
    newPaidCents,
    newBalanceCents,
    fullyPaid,
    stopReminders: fullyPaid,
  };
}
