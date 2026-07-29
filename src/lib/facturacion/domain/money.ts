// Aritmética de dinero. TODO el dinero del sistema son ENTEROS en centavos de
// peso colombiano (COP × 100). Nunca floats en montos: las cantidades (qty)
// pueden ser fraccionarias (2.5 ml) pero el resultado monetario siempre se
// redondea a entero con redondeo half-up definido aquí.

export function roundHalfUp(value: number): number {
  // Math.round redondea -0.5 hacia 0 en JS; definimos half-up clásico sobre magnitud.
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value) + Number.EPSILON);
}

export function assertMoneyInt(cents: number, label = "monto"): void {
  if (!Number.isInteger(cents)) {
    throw new Error(`${label} debe ser un entero en centavos, se recibió ${cents}`);
  }
}

/** Subtotal de línea: qty (puede ser fraccionaria) × precio unitario entero. */
export function lineSubtotalCents(qty: number, unitPriceCents: number): number {
  assertMoneyInt(unitPriceCents, "unitPriceCents");
  if (qty < 0) throw new Error("La cantidad no puede ser negativa");
  return roundHalfUp(qty * unitPriceCents);
}

/** Base gravable = subtotal - descuento (el descuento no puede exceder el subtotal). */
export function taxableBaseCents(subtotalCents: number, discountCents: number): number {
  assertMoneyInt(subtotalCents, "subtotalCents");
  assertMoneyInt(discountCents, "discountCents");
  if (discountCents < 0) throw new Error("El descuento no puede ser negativo");
  if (discountCents > subtotalCents) {
    throw new Error("El descuento no puede exceder el subtotal de la línea");
  }
  return subtotalCents - discountCents;
}

/** IVA de la línea sobre la base gravable. rate en puntos porcentuales (0|5|19). */
export function lineTaxCents(baseCents: number, ratePercent: number): number {
  assertMoneyInt(baseCents, "baseCents");
  if (![0, 5, 19].includes(ratePercent)) {
    throw new Error(`Tasa de IVA no soportada: ${ratePercent}`);
  }
  return roundHalfUp((baseCents * ratePercent) / 100);
}

export interface LineAmounts {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export function computeLineAmounts(input: {
  qty: number;
  unitPriceCents: number;
  taxRate: number;
  discountCents?: number;
}): LineAmounts {
  const subtotalCents = lineSubtotalCents(input.qty, input.unitPriceCents);
  const discountCents = input.discountCents ?? 0;
  const base = taxableBaseCents(subtotalCents, discountCents);
  const taxCents = lineTaxCents(base, input.taxRate);
  return { subtotalCents, discountCents, taxCents, totalCents: base + taxCents };
}

export interface InvoiceTotals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export function computeInvoiceTotals(lines: LineAmounts[]): InvoiceTotals {
  return lines.reduce<InvoiceTotals>(
    (acc, l) => ({
      subtotalCents: acc.subtotalCents + l.subtotalCents,
      discountCents: acc.discountCents + l.discountCents,
      taxCents: acc.taxCents + l.taxCents,
      totalCents: acc.totalCents + l.totalCents,
    }),
    { subtotalCents: 0, discountCents: 0, taxCents: 0, totalCents: 0 },
  );
}

/** Formatea centavos como pesos colombianos para UI: 1900000 → "$ 19.000". */
export function formatCOP(cents: number): string {
  assertMoneyInt(cents, "cents");
  const pesos = Math.trunc(cents / 100);
  const sign = pesos < 0 ? "-" : "";
  const digits = Math.abs(pesos).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}$ ${digits}`;
}

/** Convierte pesos (entrada de usuario) a centavos enteros. */
export function pesosToCents(pesos: number): number {
  return roundHalfUp(pesos * 100);
}
