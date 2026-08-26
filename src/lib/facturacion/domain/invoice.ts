// Construcción de líneas (fotografía histórica) y validaciones previas a emitir.
// Las validaciones (§7.5 doc) informan u orientan; solo bloquean cuando hay una
// razón fiscal, financiera o de integridad que lo exige.

import { validateBuyerData, type BuyerData } from "./dian-rules";
import { computeLineAmounts, type LineAmounts } from "./money";
import type { Role } from "./types";

export interface LineInput {
  catalogItemId?: string | null;
  description: string;
  qty: number;
  unit: string;
  unitPriceCents: number;
  taxRate: number;
  discountCents?: number;
  // contexto para validaciones (no se persiste en la línea)
  costCents?: number;
  trackStock?: boolean;
  stock?: number;
  nearExpiry?: boolean;
}

export interface LineSnapshot extends LineAmounts {
  catalogItemId: string | null;
  description: string;
  qty: number;
  unit: string;
  unitPriceCents: number;
  taxRate: number;
}

/** Congela la línea: los valores quedan copiados; cambios futuros de precio no la alteran. */
export function buildLineSnapshot(input: LineInput): LineSnapshot {
  if (!input.description.trim()) throw new Error("La línea requiere descripción");
  if (input.qty <= 0) throw new Error("La cantidad debe ser mayor que cero");
  const amounts = computeLineAmounts({
    qty: input.qty,
    unitPriceCents: input.unitPriceCents,
    taxRate: input.taxRate,
    discountCents: input.discountCents,
  });
  return {
    catalogItemId: input.catalogItemId ?? null,
    description: input.description.trim(),
    qty: input.qty,
    unit: input.unit,
    unitPriceCents: input.unitPriceCents,
    taxRate: input.taxRate,
    ...amounts,
  };
}

// ---------- Validaciones de borrador ----------

export type ValidationLevel = "WARNING" | "BLOCKER";

export interface ValidationIssue {
  level: ValidationLevel;
  code:
    | "SIN_LINEAS"
    | "EXISTENCIA_INSUFICIENTE"
    | "PRODUCTO_POR_VENCER"
    | "PRECIO_BAJO_COSTO"
    | "IMPUESTO_INVALIDO"
    | "DATOS_FISCALES_INCOMPLETOS"
    | "DESCUENTO_EXCEDE_ROL"
    // No sale de la validación del borrador sino de la emisión: el aviso de qué se imputó (o no
    // se pudo imputar) al plan de salud del paciente. Viaja por el mismo canal porque la pantalla
    // de resultado ya pinta estos avisos y un segundo canal para un solo código sería más código.
    | "PLAN_SALUD";
  message: string;
  lineIndex?: number;
}

/** Descuento máximo (%) permitido por rol; por encima se exige ADMIN. */
export function maxDiscountPctForRole(role: Role): number {
  return role === "ADMIN" ? 100 : 20;
}

export interface DraftValidationInput {
  lines: LineInput[];
  buyer: BuyerData;
  wantsElectronicDelivery: boolean;
  role: Role;
  /** Si la clínica bloquea (en vez de advertir) la venta sin existencias. */
  blockOnInsufficientStock?: boolean;
}

export function validateDraftInvoice(input: DraftValidationInput): {
  warnings: ValidationIssue[];
  blockers: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];

  if (input.lines.length === 0) {
    issues.push({ level: "BLOCKER", code: "SIN_LINEAS", message: "La factura no tiene líneas." });
  }

  input.lines.forEach((line, i) => {
    if (![0, 5, 19].includes(line.taxRate)) {
      issues.push({
        level: "BLOCKER",
        code: "IMPUESTO_INVALIDO",
        message: `"${line.description}": impuesto sin configurar o no soportado (${line.taxRate}%).`,
        lineIndex: i,
      });
    }

    if (line.trackStock && line.stock !== undefined && line.stock < line.qty) {
      issues.push({
        level: input.blockOnInsufficientStock ? "BLOCKER" : "WARNING",
        code: "EXISTENCIA_INSUFICIENTE",
        message: `"${line.description}": existencia ${line.stock} ${line.unit}, se requieren ${line.qty}.`,
        lineIndex: i,
      });
    }

    if (line.nearExpiry) {
      issues.push({
        level: "WARNING",
        code: "PRODUCTO_POR_VENCER",
        message: `"${line.description}": hay lote próximo a vencer.`,
        lineIndex: i,
      });
    }

    if (line.costCents !== undefined && line.costCents > 0 && line.unitPriceCents < line.costCents) {
      issues.push({
        level: "WARNING",
        code: "PRECIO_BAJO_COSTO",
        message: `"${line.description}": el precio de venta está por debajo del costo.`,
        lineIndex: i,
      });
    }

    const subtotal = line.qty * line.unitPriceCents;
    const discount = line.discountCents ?? 0;
    if (subtotal > 0 && discount > 0) {
      const pct = (discount / subtotal) * 100;
      if (pct > maxDiscountPctForRole(input.role)) {
        issues.push({
          level: "BLOCKER",
          code: "DESCUENTO_EXCEDE_ROL",
          message: `"${line.description}": descuento ${pct.toFixed(1)}% excede el máximo del rol ${input.role}. Requiere ADMIN.`,
          lineIndex: i,
        });
      }
    }
  });

  const buyerCheck = validateBuyerData(input.buyer, {
    wantsElectronicDelivery: input.wantsElectronicDelivery,
  });
  if (!buyerCheck.valid) {
    issues.push({
      level: "BLOCKER",
      code: "DATOS_FISCALES_INCOMPLETOS",
      message: `Faltan datos del responsable del pago: ${buyerCheck.missing.join(", ")}.`,
    });
  }

  return {
    warnings: issues.filter((i) => i.level === "WARNING"),
    blockers: issues.filter((i) => i.level === "BLOCKER"),
  };
}
