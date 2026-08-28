// Máquina de estados de factura en CUATRO dimensiones independientes:
// fiscal, recaudo, entrega (derivadas de eventos) y seguimiento de cartera
// (derivada de eventos + contexto de recordatorios). El estado NUNCA se setea
// a mano. Funciones puras: reciben eventos + contexto y devuelven el estado.

import { daysOverdue } from "./aging";
import type {
  CollectionStatus,
  DeliveryStatus,
  FiscalStatus,
  FollowupStatus,
  InvoiceEventLike,
} from "./types";

export interface DerivedStatus {
  fiscal: FiscalStatus;
  collection: CollectionStatus;
  delivery: DeliveryStatus;
  paidCents: number;
  creditedCents: number;
  balanceCents: number;
  remindersPaused: boolean;
  /** Promesa de pago vigente (hasta cuándo), si existe. */
  promiseActiveUntil: Date | null;
}

interface StatusContext {
  now: Date;
  totalCents: number;
  dueDate?: Date | null;
}

function paymentAmount(e: InvoiceEventLike): number {
  const p = e.payload as { amountCents?: number } | undefined;
  return p?.amountCents ?? 0;
}

export function deriveStatus(events: InvoiceEventLike[], ctx: StatusContext): DerivedStatus {
  const ordered = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // --- Dimensión fiscal ---
  let fiscal: FiscalStatus = "BORRADOR";
  for (const e of ordered) {
    if (e.type === "ISSUED" || e.type === "FISCAL_SUBMITTED") {
      if (fiscal === "BORRADOR") fiscal = "PENDIENTE_VALIDACION";
    } else if (e.type === "FISCAL_VALIDATED") {
      fiscal = "VALIDADA";
    } else if (e.type === "FISCAL_REJECTED") {
      fiscal = "RECHAZADA";
    } else if (e.type === "CREDIT_NOTE_APPLIED") {
      fiscal = "AFECTADA_POR_NOTA_CREDITO";
    }
  }

  // --- Acumulados de recaudo ---
  let paidCents = 0;
  let creditedCents = 0;
  let disputeOpen = false;
  let writtenOff = false;
  let remindersPaused = false;
  let promiseUntil: Date | null = null;

  for (const e of ordered) {
    switch (e.type) {
      case "PAYMENT_APPLIED":
        paidCents += paymentAmount(e);
        break;
      case "CREDIT_NOTE_APPLIED":
        creditedCents += paymentAmount(e);
        break;
      case "DISPUTE_OPENED":
        disputeOpen = true;
        break;
      case "DISPUTE_CLOSED":
        disputeOpen = false;
        break;
      case "WRITTEN_OFF":
        writtenOff = true;
        break;
      case "REMINDERS_PAUSED":
        remindersPaused = true;
        break;
      case "REMINDERS_RESUMED":
        remindersPaused = false;
        break;
      case "PROMISE_TO_PAY": {
        const p = e.payload as { until?: string } | undefined;
        promiseUntil = p?.until ? new Date(p.until) : null;
        break;
      }
    }
  }

  const balanceCents = Math.max(0, ctx.totalCents - paidCents - creditedCents);
  const promiseActive = promiseUntil !== null && ctx.now.getTime() <= promiseUntil.getTime();

  // --- Dimensión de recaudo ---
  // Prioridad: castigo > disputa > pagada > promesa vigente > vencida > parcial.
  // EN_PROMESA_DE_PAGO es un estado real (§3 spec): el cliente se comprometió
  // a una fecha y hasta entonces la factura no se trata como vencida.
  let collection: CollectionStatus;
  if (writtenOff) {
    collection = "CASTIGADA";
  } else if (disputeOpen) {
    collection = "EN_DISPUTA";
  } else if (balanceCents === 0 && ctx.totalCents > 0) {
    collection = "PAGADA";
  } else if (promiseActive && balanceCents > 0) {
    collection = "EN_PROMESA_DE_PAGO";
  } else if (ctx.dueDate && ctx.now.getTime() > ctx.dueDate.getTime() && balanceCents > 0) {
    collection = "VENCIDA";
  } else if (paidCents > 0 && balanceCents > 0) {
    collection = "PARCIALMENTE_PAGADA";
  } else {
    collection = "PENDIENTE";
  }

  // --- Dimensión de entrega ---
  let delivery: DeliveryStatus = "NO_ENVIADA";
  for (const e of ordered) {
    if (e.type === "QUEUED") {
      if (delivery === "NO_ENVIADA" || delivery === "FALLIDA") delivery = "EN_COLA";
    } else if (e.type === "SENT") delivery = "ENVIADA";
    else if (e.type === "DELIVERED") delivery = "ENTREGADA";
    else if (e.type === "DELIVERY_FAILED") delivery = "FALLIDA";
  }

  // Los recordatorios se detienen por: pago total, disputa, castigo, pausa manual
  // o promesa de pago vigente (§11.2 doc).
  const paused =
    remindersPaused || disputeOpen || writtenOff || collection === "PAGADA" || promiseActive;

  return {
    fiscal,
    collection,
    delivery,
    paidCents,
    creditedCents,
    balanceCents,
    remindersPaused: paused,
    promiseActiveUntil: promiseActive ? promiseUntil : null,
  };
}

// ─── Vencer es cosa del RELOJ, no de un evento ───────────────────────────────

/**
 * El estado de recaudo que hay que MOSTRAR, a partir del guardado y de la fecha.
 *
 * ── EL DEFECTO, encontrado en la auditoría del 27-ago ──────────────────────────────────────────
 *
 * `deriveStatus` calcula `VENCIDA` bien (más arriba, línea del `dueDate`), pero sólo corre cuando
 * PASA UN EVENTO: un pago, una nota crédito, una promesa. **Vencer no es un evento** — es que se
 * acabó un plazo mientras nadie tocaba nada. Así que la columna `collection_status` se quedaba en
 * `PENDIENTE` para siempre, y el planificador de cartera tampoco la despertaba: sólo refresca las
 * que están en promesa de pago, y sólo mira facturas con seguimiento activo.
 *
 * El resultado se veía en la MISMA FILA de la pantalla de Cartera:
 *
 *   · el KPI «Cartera vencida» y los tramos de antigüedad decían $317.620 vencidos — eso se calcula
 *     al leer, contra `due_date`, con `computeAging`;
 *   · la insignia de al lado decía «Pendiente de pago» — eso salía de la columna.
 *
 * SPOS-2 llevaba once días vencida y SPOS-4 seis. Una pantalla contradiciéndose consigo misma a dos
 * centímetros de distancia.
 *
 * ── POR QUÉ SE DERIVA AL LEER Y NO SE ESCRIBE ─────────────────────────────────────────────────
 *
 * Escribirlo pediría un barrido periódico, y no hay dónde: el plan de Vercel es Hobby y sus dos
 * cupos de cron ya están usados. Pero además sería peor aunque hubiera: un estado guardado siempre
 * está a lo sumo tan fresco como la última corrida, así que entre barridos volvería a mentir. La
 * fecha ya está en la fila; derivar al leer no puede desincronizarse nunca.
 *
 * ── Y USA EL MISMO RELOJ QUE LOS TRAMOS, QUE ES TODO EL ARREGLO ───────────────────────────────
 *
 * `daysOverdue` de `aging.ts` es la función que ya alimenta al KPI y a las cinco columnas de
 * antigüedad. Reusarla no es prolijidad: es lo que GARANTIZA que la insignia y el tramo no puedan
 * volver a discrepar. Y trae de arriba el manejo de zona horaria — las dos fechas se llevan al
 * calendario de Bogotá — que en Vercel (UTC) es lo que evita que todo lo que vence HOY aparezca con
 * un día de mora a partir de las 19:00.
 *
 * ── SÓLO ASCIENDE, NUNCA PISA ─────────────────────────────────────────────────────────────────
 *
 * `deriveStatus` tiene una precedencia: castigo > disputa > pagada > promesa vigente > VENCIDA >
 * parcial > pendiente. Acá se respeta al pie: se asciende únicamente desde los dos estados que
 * `VENCIDA` supera. Una castigada, una en disputa o una con promesa vigente se quedan como están —
 * la promesa, en particular, existe justamente para que la factura NO se trate como vencida.
 */
export function estadoDeCobroVisible(
  guardado: CollectionStatus,
  factura: { dueDate: string | null; balanceCents: number },
  now: Date,
): CollectionStatus {
  if (guardado !== "PENDIENTE" && guardado !== "PARCIALMENTE_PAGADA") return guardado;
  if (factura.balanceCents <= 0) return guardado;
  return daysOverdue(factura.dueDate, now) > 0 ? "VENCIDA" : guardado;
}

// ─── 4ª dimensión: estado del seguimiento de cartera ─────────────────────────

export interface FollowupContext {
  /** El vet activó seguimiento para esta factura (toggle de emisión). */
  followupEnabled: boolean;
  /** La factura nació con saldo por cobrar (PENDIENTE o ABONO_PARCIAL). */
  followupRequired: boolean;
  /** Derivado de eventos (deriveStatus). */
  derived: Pick<DerivedStatus, "collection" | "balanceCents" | "remindersPaused">;
  /** ¿Existe una tarea humana abierta para esta factura? (F2; default false). */
  hasOpenHumanTask?: boolean;
  /** ¿El cliente revocó todos los canales autorizados? (F2; default false). */
  allChannelsRevoked?: boolean;
  /** ¿Ya se envió al menos un recordatorio? (F2; default false). */
  anyReminderSent?: boolean;
}

/**
 * Deriva el estado del seguimiento. Pura y determinista:
 * NO_REQUERIDO → la factura no necesita cartera (pagada al emitir u opt-out).
 * PROGRAMADO → hay pasos futuros pero nada enviado aún.
 * ACTIVO → ya hubo al menos un contacto de cobranza.
 * PAUSADO → promesa vigente, disputa o pausa manual.
 * COMPLETADO → el saldo llegó a cero habiendo tenido seguimiento.
 * CANCELADO → sin canales autorizados para contactar.
 * REQUIERE_ATENCION_HUMANA → tarea humana abierta (domina sobre el resto).
 */
export function deriveFollowupStatus(ctx: FollowupContext): FollowupStatus {
  if (!ctx.followupRequired || !ctx.followupEnabled) return "NO_REQUERIDO";
  if (ctx.hasOpenHumanTask) return "REQUIERE_ATENCION_HUMANA";
  if (ctx.derived.balanceCents === 0) return "COMPLETADO";
  if (ctx.derived.collection === "CASTIGADA") return "CANCELADO";
  if (ctx.allChannelsRevoked) return "CANCELADO";
  if (ctx.derived.remindersPaused) return "PAUSADO";
  return ctx.anyReminderSent ? "ACTIVO" : "PROGRAMADO";
}
