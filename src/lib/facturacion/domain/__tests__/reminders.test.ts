import { describe, expect, it } from "vitest";
import { holidaySet } from "@/lib/facturacion/domain/holidays";
import {
  canContact,
  DEFAULT_POLICY_STEPS,
  isSameWeek,
  isWithinAllowedWindow,
  nextAllowedTime,
  scheduleReminders,
  selectChannel,
  shouldStopReminders,
} from "@/lib/facturacion/domain/reminders";

const holidays = holidaySet([2026]);
// Referencias 2026: vie 17-jul · sáb 18-jul · dom 19-jul · lun 20-jul (FESTIVO) · mar 21-jul

describe("reminders: programación por política", () => {
  it("política por defecto: vencimiento, +3, +7, +15", () => {
    const due = new Date(2026, 7, 1); // 1-ago-2026
    const schedule = scheduleReminders(due, DEFAULT_POLICY_STEPS);
    expect(schedule.map((s) => s.kind)).toEqual([
      "RECORDATORIO_1",
      "RECORDATORIO_2",
      "AVISO_SALDO",
      "ESCALAMIENTO",
    ]);
    expect(schedule[0].scheduledFor.getDate()).toBe(1);
    expect(schedule[1].scheduledFor.getDate()).toBe(4);
    expect(schedule[2].scheduledFor.getDate()).toBe(8);
    expect(schedule[3].scheduledFor.getDate()).toBe(16);
  });
});

describe("reminders: ventanas Ley 2300 (forzadas)", () => {
  it("día hábil 7:00–19:00", () => {
    expect(isWithinAllowedWindow(new Date(2026, 6, 17, 10, 0), holidays)).toBe(true);
    expect(isWithinAllowedWindow(new Date(2026, 6, 17, 6, 59), holidays)).toBe(false);
    expect(isWithinAllowedWindow(new Date(2026, 6, 17, 19, 0), holidays)).toBe(false);
  });

  it("sábado 8:00–15:00", () => {
    expect(isWithinAllowedWindow(new Date(2026, 6, 18, 9, 0), holidays)).toBe(true);
    expect(isWithinAllowedWindow(new Date(2026, 6, 18, 15, 30), holidays)).toBe(false);
  });

  it("HOSTIL: nunca domingo", () => {
    expect(isWithinAllowedWindow(new Date(2026, 6, 19, 10, 0), holidays)).toBe(false);
  });

  it("HOSTIL: nunca festivo (lunes 20-jul-2026)", () => {
    expect(isWithinAllowedWindow(new Date(2026, 6, 20, 10, 0), holidays)).toBe(false);
  });

  it("nextAllowedTime salta domingo y festivo hasta el martes 7:00", () => {
    const next = nextAllowedTime(new Date(2026, 6, 19, 10, 0), holidays);
    expect(next.getDate()).toBe(21);
    expect(next.getHours()).toBe(7);
  });

  it("nextAllowedTime respeta el mismo día si aún hay ventana", () => {
    const next = nextAllowedTime(new Date(2026, 6, 17, 5, 0), holidays);
    expect(next.getDate()).toBe(17);
    expect(next.getHours()).toBe(7);
  });
});

describe("reminders: reglas de contacto Ley 2300", () => {
  const base = {
    holidays,
    authorizedChannels: ["WHATSAPP" as const],
    channel: "WHATSAPP" as const,
    contactsOnSameDay: 0,
    lastDirectContact: null,
  };
  const tuesday10am = new Date(2026, 6, 21, 10, 0);

  it("permite contacto válido", () => {
    expect(canContact(tuesday10am, base)).toEqual({ allowed: true });
  });

  it("HOSTIL: canal no autorizado por el consumidor", () => {
    const r = canContact(tuesday10am, { ...base, channel: "EMAIL" });
    expect(r).toEqual({ allowed: false, reason: "CANAL_NO_AUTORIZADO" });
  });

  it("HOSTIL: máximo un contacto por día", () => {
    const r = canContact(tuesday10am, { ...base, contactsOnSameDay: 1 });
    expect(r).toEqual({ allowed: false, reason: "MAX_UN_CONTACTO_POR_DIA" });
  });

  it("HOSTIL: tras contacto directo, no multicanal en la misma semana", () => {
    const r = canContact(tuesday10am, {
      ...base,
      authorizedChannels: ["WHATSAPP", "EMAIL"],
      channel: "EMAIL",
      lastDirectContact: { at: new Date(2026, 6, 20, 10, 0), channel: "WHATSAPP" },
    });
    expect(r).toEqual({ allowed: false, reason: "MULTICANAL_MISMA_SEMANA" });
  });

  it("el mismo canal en la misma semana sí se permite (un contacto/día)", () => {
    const r = canContact(tuesday10am, {
      ...base,
      lastDirectContact: { at: new Date(2026, 6, 20, 10, 0), channel: "WHATSAPP" },
    });
    expect(r).toEqual({ allowed: true });
  });

  it("isSameWeek usa semana lunes–domingo", () => {
    expect(isSameWeek(new Date(2026, 6, 20), new Date(2026, 6, 26))).toBe(true);
    expect(isSameWeek(new Date(2026, 6, 19), new Date(2026, 6, 20))).toBe(false);
  });
});

describe("reminders: condiciones de detención", () => {
  const now = new Date(2026, 6, 17);
  const none = {
    fullyPaid: false,
    disputeOpen: false,
    debtUnknownByClient: false,
    promiseToPayUntil: null,
    manuallyPaused: false,
    channelAuthorizationRevoked: false,
  };

  it("sin causal, continúa", () => {
    expect(shouldStopReminders(none, now)).toEqual({ stop: false });
  });

  it.each([
    [{ fullyPaid: true }, "PAGO_TOTAL"],
    [{ debtUnknownByClient: true }, "DESCONOCE_COBRO"],
    [{ disputeOpen: true }, "DISPUTA_ABIERTA"],
    [{ promiseToPayUntil: new Date(2026, 6, 25) }, "PROMESA_DE_PAGO_VIGENTE"],
    [{ manuallyPaused: true }, "PAUSA_MANUAL"],
    [{ channelAuthorizationRevoked: true }, "AUTORIZACION_REVOCADA"],
  ])("se detiene por %j", (override, reason) => {
    expect(shouldStopReminders({ ...none, ...override }, now)).toEqual({ stop: true, reason });
  });

  it("promesa expirada no detiene", () => {
    const r = shouldStopReminders({ ...none, promiseToPayUntil: new Date(2026, 6, 10) }, now);
    expect(r).toEqual({ stop: false });
  });
});

describe("reminders: selección de canal omnicanal (§4.2)", () => {
  const both: ("WHATSAPP" | "EMAIL")[] = ["WHATSAPP", "EMAIL"];

  it("usa el canal principal cuando está autorizado y conectado", () => {
    const r = selectChannel({ preferred: "WHATSAPP", authorized: both, connected: both });
    expect(r).toEqual({ channel: "WHATSAPP", fallback: false });
  });

  it("cae al alterno si el principal no está conectado (fallback marcado)", () => {
    const r = selectChannel({
      preferred: "WHATSAPP",
      authorized: both,
      connected: ["EMAIL"],
    });
    expect(r).toEqual({ channel: "EMAIL", fallback: true });
  });

  it("HOSTIL: nunca usa un canal no autorizado por el cliente", () => {
    const r = selectChannel({
      preferred: "WHATSAPP",
      authorized: ["EMAIL"], // WhatsApp NO autorizado
      connected: both,
    });
    expect(r).toEqual({ channel: "EMAIL", fallback: true });
  });

  it("sin canales autorizados/conectados → SIN_CANAL_DISPONIBLE", () => {
    const r = selectChannel({ preferred: "WHATSAPP", authorized: [], connected: both });
    expect(r).toEqual({ channel: null, reason: "SIN_CANAL_DISPONIBLE" });
  });

  it("evita el canal que acaba de fallar si hay alternativa legal", () => {
    const r = selectChannel({
      preferred: "WHATSAPP",
      authorized: both,
      connected: both,
      lastFailedChannel: "WHATSAPP",
    });
    expect(r).toEqual({ channel: "EMAIL", fallback: true });
  });

  it("si el único canal usable es el que falló, lo usa igual", () => {
    const r = selectChannel({
      preferred: "WHATSAPP",
      authorized: ["WHATSAPP"],
      connected: ["WHATSAPP"],
      lastFailedChannel: "WHATSAPP",
    });
    expect(r).toEqual({ channel: "WHATSAPP", fallback: false });
  });

  it("HOSTIL: tras contacto directo esta semana, no cambia de canal (no multicanal)", () => {
    // El cliente respondió por WhatsApp esta semana: aunque el principal sea EMAIL,
    // solo se puede seguir por WhatsApp.
    const r = selectChannel({
      preferred: "EMAIL",
      authorized: both,
      connected: both,
      directContactChannelThisWeek: "WHATSAPP",
    });
    expect(r).toEqual({ channel: "WHATSAPP", fallback: true });
  });

  it("HOSTIL: contacto directo por un canal ahora no autorizado → sin canal", () => {
    const r = selectChannel({
      preferred: "EMAIL",
      authorized: ["EMAIL"], // WhatsApp ya no autorizado
      connected: both,
      directContactChannelThisWeek: "WHATSAPP", // pero está lockeado a WhatsApp
    });
    expect(r).toEqual({ channel: null, reason: "SIN_CANAL_DISPONIBLE" });
  });
});
