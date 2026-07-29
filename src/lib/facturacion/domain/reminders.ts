// Motor de recordatorios + restricciones de la Ley 2300 de 2023.
// Las restricciones legales están FORZADAS por código: no son configurables
// por la clínica. El reloj ("now") y el calendario de festivos se INYECTAN
// para que todo sea determinista y testeable.

import { toYMD } from "./holidays";
import type { Channel, ReminderStepKind } from "./types";

export interface PolicyStep {
  kind: ReminderStepKind;
  offsetDays: number; // días después del vencimiento
}

// Política por defecto (§4 master prompt): vencimiento → +3 → +7 → +15.
// El ENVIO_FACTURA ocurre al emitir, no se programa contra el vencimiento.
export const DEFAULT_POLICY_STEPS: PolicyStep[] = [
  { kind: "RECORDATORIO_1", offsetDays: 0 },
  { kind: "RECORDATORIO_2", offsetDays: 3 },
  { kind: "AVISO_SALDO", offsetDays: 7 },
  { kind: "ESCALAMIENTO", offsetDays: 15 },
];

/** Hora del día a la que se intenta enviar cada paso (dentro de ventana legal). */
const SEND_HOUR = 9;

export function scheduleReminders(
  dueDate: Date,
  steps: PolicyStep[] = DEFAULT_POLICY_STEPS,
): { kind: ReminderStepKind; scheduledFor: Date }[] {
  return steps.map((s) => {
    const d = new Date(dueDate);
    d.setDate(d.getDate() + s.offsetDays);
    d.setHours(SEND_HOUR, 0, 0, 0);
    return { kind: s.kind, scheduledFor: d };
  });
}

// ---------- Ley 2300 de 2023: ventanas de contacto ----------
// Lun–Vie 7:00–19:00 · Sáb 8:00–15:00 · Nunca domingos ni festivos.

export function isWithinAllowedWindow(date: Date, holidays: Set<string>): boolean {
  const dow = date.getDay(); // 0=domingo ... 6=sábado
  if (dow === 0) return false;
  if (holidays.has(toYMD(date))) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (dow === 6) return minutes >= 8 * 60 && minutes < 15 * 60;
  return minutes >= 7 * 60 && minutes < 19 * 60;
}

/** Lunes (00:00) de la semana de una fecha — la Ley habla de "misma semana". */
function weekStart(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  const dow = r.getDay();
  const delta = dow === 0 ? 6 : dow - 1;
  r.setDate(r.getDate() - delta);
  return r;
}

export function isSameWeek(a: Date, b: Date): boolean {
  return weekStart(a).getTime() === weekStart(b).getTime();
}

export interface ContactContext {
  holidays: Set<string>;
  /** Canales que el consumidor autorizó explícitamente. */
  authorizedChannels: Channel[];
  /** Canal por el que se pretende contactar. */
  channel: Channel;
  /** Contactos de cobranza YA realizados a este deudor el mismo día. */
  contactsOnSameDay: number;
  /** Último contacto DIRECTO efectivo (respuesta del deudor), si existe. */
  lastDirectContact?: { at: Date; channel: Channel } | null;
}

export type ContactDenialReason =
  | "CANAL_NO_AUTORIZADO"
  | "FUERA_DE_HORARIO"
  | "MAX_UN_CONTACTO_POR_DIA"
  | "MULTICANAL_MISMA_SEMANA";

export function canContact(
  desired: Date,
  ctx: ContactContext,
): { allowed: true } | { allowed: false; reason: ContactDenialReason } {
  if (!ctx.authorizedChannels.includes(ctx.channel)) {
    return { allowed: false, reason: "CANAL_NO_AUTORIZADO" };
  }
  if (!isWithinAllowedWindow(desired, ctx.holidays)) {
    return { allowed: false, reason: "FUERA_DE_HORARIO" };
  }
  if (ctx.contactsOnSameDay >= 1) {
    return { allowed: false, reason: "MAX_UN_CONTACTO_POR_DIA" };
  }
  const direct = ctx.lastDirectContact;
  if (direct && isSameWeek(direct.at, desired) && direct.channel !== ctx.channel) {
    return { allowed: false, reason: "MULTICANAL_MISMA_SEMANA" };
  }
  return { allowed: true };
}

/**
 * Próximo instante permitido por la ventana legal a partir de `desired`.
 * Avanza al inicio de la siguiente ventana válida (día hábil 7:00 / sábado 8:00).
 */
export function nextAllowedTime(desired: Date, holidays: Set<string>): Date {
  const d = new Date(desired);
  for (let guard = 0; guard < 366 * 2; guard++) {
    const dow = d.getDay();
    const isHoliday = dow === 0 || holidays.has(toYMD(d));
    if (!isHoliday) {
      const open = dow === 6 ? 8 * 60 : 7 * 60;
      const close = dow === 6 ? 15 * 60 : 19 * 60;
      const minutes = d.getHours() * 60 + d.getMinutes();
      if (minutes < open) {
        d.setHours(Math.floor(open / 60), open % 60, 0, 0);
        return d;
      }
      if (minutes < close) return d;
    }
    // pasar al día siguiente a las 00:00 y reintentar
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
  }
  throw new Error("No se encontró ventana de contacto válida en dos años");
}

// ---------- Condiciones de detención (§11.2 doc) ----------

export interface ReminderStopState {
  fullyPaid: boolean;
  disputeOpen: boolean;
  debtUnknownByClient: boolean;
  promiseToPayUntil?: Date | null;
  manuallyPaused: boolean;
  channelAuthorizationRevoked: boolean;
}

export type StopReason =
  | "PAGO_TOTAL"
  | "DESCONOCE_COBRO"
  | "DISPUTA_ABIERTA"
  | "PROMESA_DE_PAGO_VIGENTE"
  | "PAUSA_MANUAL"
  | "AUTORIZACION_REVOCADA";

export function shouldStopReminders(
  state: ReminderStopState,
  now: Date,
): { stop: false } | { stop: true; reason: StopReason } {
  if (state.fullyPaid) return { stop: true, reason: "PAGO_TOTAL" };
  if (state.debtUnknownByClient) return { stop: true, reason: "DESCONOCE_COBRO" };
  if (state.disputeOpen) return { stop: true, reason: "DISPUTA_ABIERTA" };
  if (state.promiseToPayUntil && now.getTime() <= state.promiseToPayUntil.getTime()) {
    return { stop: true, reason: "PROMESA_DE_PAGO_VIGENTE" };
  }
  if (state.manuallyPaused) return { stop: true, reason: "PAUSA_MANUAL" };
  if (state.channelAuthorizationRevoked) return { stop: true, reason: "AUTORIZACION_REVOCADA" };
  return { stop: false };
}

// ---------- Selección de canal omnicanal (§4.2 doc) ----------
// El motor decide POR CUÁL canal contactar. Nunca envía por ambos a la vez:
// elige uno con esta prioridad y solo cae al alterno si el principal no sirve
// y el cambio es legal (canal autorizado). Función pura y determinista.

export interface ChannelSelectionInput {
  /** Canal principal definido por la política de la clínica. */
  preferred: Channel;
  /** Canales que el consumidor autorizó (Ley 2300: sin autorización, no se usa). */
  authorized: Channel[];
  /** Canales cuya integración está conectada y operativa. */
  connected: Channel[];
  /** El envío anterior por este canal falló → evitarlo si hay alternativa. */
  lastFailedChannel?: Channel | null;
  /**
   * Contacto DIRECTO previo esta semana (respuesta del deudor). Cambiar de canal
   * dentro de la misma semana tras contacto directo está vedado (§5).
   */
  directContactChannelThisWeek?: Channel | null;
}

export type ChannelSelectionResult =
  | { channel: Channel; fallback: boolean }
  | { channel: null; reason: "SIN_CANAL_DISPONIBLE" };

const ALL_CHANNELS: Channel[] = ["WHATSAPP", "EMAIL"];

export function selectChannel(input: ChannelSelectionInput): ChannelSelectionResult {
  const usable = (c: Channel): boolean =>
    input.authorized.includes(c) && input.connected.includes(c);

  // Si hubo contacto directo esta semana, solo se puede seguir por ESE canal.
  const locked = input.directContactChannelThisWeek ?? null;

  // Orden de preferencia: principal primero, luego el resto.
  const order: Channel[] = [input.preferred, ...ALL_CHANNELS.filter((c) => c !== input.preferred)];

  const candidates = order.filter((c) => {
    if (!usable(c)) return false;
    if (locked && c !== locked) return false; // no multicanal misma semana
    // Evitar el canal que acaba de fallar salvo que sea el único.
    return true;
  });

  if (candidates.length === 0) return { channel: null, reason: "SIN_CANAL_DISPONIBLE" };

  // Preferir uno que no sea el que falló; si el único usable es el que falló, usarlo.
  const notFailed = candidates.filter((c) => c !== input.lastFailedChannel);
  const pick = notFailed[0] ?? candidates[0];
  return { channel: pick, fallback: pick !== input.preferred };
}
