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

// ─── Descuento global ────────────────────────────────────────────────────────

/**
 * Reparte un descuento de la FACTURA entre sus líneas, en proporción a lo que pesa cada una.
 *
 * ── POR QUÉ SE PRORRATEA Y NO SE RESTA DEL TOTAL ──────────────────────────────────────────────
 *
 * Restarlo del total sería una línea de código y estaría MAL. El IVA en Colombia se liquida por
 * línea sobre su base gravable, y las líneas de una misma factura no comparten tarifa: una consulta
 * va al 19 %, un medicamento POS puede ir excluido, un servicio al 5 %. Si el descuento se resta al
 * final, el IVA ya calculado no se entera:
 *
 *   subtotal 100.000 − descuento 10.000 = base 90.000, pero el impuesto seguiría siendo el de
 *   100.000. El documento deja de cuadrar consigo mismo — `base × tarifa ≠ impuesto` — y eso no es
 *   un detalle de presentación: es lo que la DIAN valida.
 *
 * Prorrateado, en cambio, cada línea baja su base y RECALCULA su impuesto a SU propia tarifa. La
 * factura cuadra sola y el descuento cae donde de verdad cayó.
 *
 * ── EL PESO ES LA BASE, NO EL SUBTOTAL ────────────────────────────────────────────────────────
 *
 * Se reparte sobre `subtotal − descuento de línea`, no sobre el subtotal bruto. Así una línea que ya
 * venía rebajada no vuelve a absorber descuento en proporción a un precio que nadie va a pagar, y de
 * paso queda garantizado que el descuento total de una línea nunca supera su subtotal —que es
 * justo lo que `taxableBaseCents` rechaza.
 *
 * ── EL RESIDUO SE REPARTE, NO SE PIERDE ───────────────────────────────────────────────────────
 *
 * En centavos enteros la proporción casi nunca da exacta. Con truncar y ya, la suma de las partes
 * queda por debajo del descuento pedido y el vet ve un número distinto del que escribió. Se usa el
 * método del RESTO MAYOR: se trunca, y los centavos sobrantes van a las líneas cuya fracción quedó
 * más cerca de subir. La suma de lo repartido es EXACTAMENTE el descuento pedido, siempre.
 *
 * @param basesCents  Base de cada línea (subtotal menos su propio descuento), en centavos.
 * @param globalCents Descuento de la factura, en centavos.
 * @returns Cuánto le toca a cada línea, en el mismo orden. Suma exacta = globalCents.
 */
export function prorratearDescuentoGlobal(basesCents: number[], globalCents: number): number[] {
  assertMoneyInt(globalCents, "globalCents");
  basesCents.forEach((b, i) => assertMoneyInt(b, `basesCents[${i}]`));
  if (globalCents < 0) throw new Error("El descuento global no puede ser negativo");
  if (globalCents === 0) return basesCents.map(() => 0);

  const totalBase = basesCents.reduce((a, b) => a + b, 0);
  if (totalBase <= 0) {
    throw new Error("No hay base sobre la cual aplicar el descuento global");
  }
  if (globalCents > totalBase) {
    throw new Error("El descuento global no puede exceder el subtotal de la factura");
  }

  // Parte entera por línea, y la fracción que queda pendiente de repartir.
  const exactos = basesCents.map((b) => (b * globalCents) / totalBase);
  const partes = exactos.map((e) => Math.floor(e));
  let sobrante = globalCents - partes.reduce((a, b) => a + b, 0);

  // Resto mayor: primero las que quedaron más cerca de subir. El desempate por índice mantiene el
  // resultado DETERMINISTA — con dos líneas iguales, la de arriba se lleva el centavo siempre.
  const orden = exactos
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of orden) {
    if (sobrante <= 0) break;
    partes[i] += 1;
    sobrante -= 1;
  }
  return partes;
}
