import { describe, expect, it } from 'vitest';
import {
  CARTERA_INTENTS,
  INTENT_ACTIONS,
  humanTaskTitle,
  renderReply,
  type CarteraIntent,
} from '../intents';

const CTX = { number: 'SPOS-123', link: 'https://app.tuvetia.com/f/tok', promiseDate: '2026-07-25' };

describe('mapeo intención → acción (§B15b)', () => {
  it('cubre exactamente los 8 intents del catálogo cerrado', () => {
    expect(CARTERA_INTENTS).toHaveLength(8);
    for (const intent of CARTERA_INTENTS) {
      expect(INTENT_ACTIONS[intent]).toBeDefined();
    }
  });

  it('«ya pagué» → verificar comprobante + pausa + pedir comprobante', () => {
    const a = INTENT_ACTIONS.YA_PAGUE;
    expect(a.task).toBe('VERIFICAR_COMPROBANTE');
    expect(a.pauseReminders).toBe(true);
    expect(a.event).toBeNull();
    expect(a.reply).toBe('PEDIR_COMPROBANTE');
  });

  it('«le transfiero el <fecha>» → evento PROMISE_TO_PAY, sin tarea', () => {
    const a = INTENT_ACTIONS.PROMESA_PAGO;
    expect(a.event).toBe('PROMISE_TO_PAY');
    expect(a.task).toBeNull();
    // La promesa ya pausa vía deriveStatus; no se duplica con REMINDERS_PAUSED.
    expect(a.pauseReminders).toBe(false);
  });

  it('«envíeme el enlace» → reenvía link, sin evento ni tarea', () => {
    const a = INTENT_ACTIONS.PEDIR_ENLACE;
    expect(a.resendLink).toBe(true);
    expect(a.task).toBeNull();
    expect(a.event).toBeNull();
    expect(a.reply).toBe('ENLACE');
  });

  it('«no reconozco» → disputa (evento + tarea), detiene cobranza', () => {
    const a = INTENT_ACTIONS.DISPUTA;
    expect(a.event).toBe('DISPUTE_OPENED');
    expect(a.task).toBe('DISPUTA');
  });

  it('«necesito más plazo» → tarea SOLICITUD_PLAZO; el agente NO concede plazo', () => {
    const a = INTENT_ACTIONS.SOLICITUD_PLAZO;
    expect(a.task).toBe('SOLICITUD_PLAZO');
    expect(a.event).toBeNull();
    expect(a.pauseReminders).toBe(false); // no pausa: no concede nada
  });

  it('«quiero hablar con alguien» → contacto solicitado + pausa', () => {
    const a = INTENT_ACTIONS.CONTACTO_HUMANO;
    expect(a.task).toBe('CONTACTO_SOLICITADO');
    expect(a.pauseReminders).toBe(true);
  });

  it('«no me escriban más» → revoca el canal', () => {
    const a = INTENT_ACTIONS.OPT_OUT;
    expect(a.revokeChannel).toBe(true);
    expect(a.task).toBeNull();
    expect(a.event).toBeNull();
  });

  it('no clasificable → tarea OTRO, SIN respuesta automática', () => {
    const a = INTENT_ACTIONS.OTRO;
    expect(a.task).toBe('OTRO');
    expect(a.reply).toBeNull();
  });

  it('ningún intent registra pago ni concede plazo por sí mismo (doctrina)', () => {
    // El único evento de recaudo que dispara el agente es la promesa; jamás un
    // PAYMENT_APPLIED, CREDIT_NOTE_APPLIED ni WRITTEN_OFF.
    for (const intent of CARTERA_INTENTS) {
      const ev = INTENT_ACTIONS[intent].event;
      expect(ev === null || ev === 'PROMISE_TO_PAY' || ev === 'DISPUTE_OPENED').toBe(true);
    }
  });
});

describe('respuestas por plantilla (fijas, nunca del modelo)', () => {
  it('incluye la fecha en la promesa cuando existe', () => {
    expect(renderReply('PROMESA_OK', CTX)).toContain('2026-07-25');
  });

  it('la promesa sin fecha pide la fecha, no inventa una', () => {
    const r = renderReply('PROMESA_SIN_FECHA', { number: CTX.number, link: CTX.link });
    expect(r).toMatch(/fecha/i);
    expect(r).not.toContain('2026');
  });

  it('el enlace y el número aparecen en la respuesta de PEDIR_ENLACE', () => {
    const r = renderReply('ENLACE', CTX);
    expect(r).toContain(CTX.link);
    expect(r).toContain(CTX.number);
  });

  it('renderReply cubre todas las claves de respuesta usadas por el mapeo', () => {
    const keys = new Set(
      CARTERA_INTENTS.map((i) => INTENT_ACTIONS[i].reply).filter((k): k is NonNullable<typeof k> => k !== null),
    );
    for (const key of keys) {
      expect(renderReply(key, CTX).length).toBeGreaterThan(0);
    }
  });
});

describe('títulos de tareas humanas', () => {
  it('genera un título legible por tipo con el número de factura', () => {
    const kinds = ['VERIFICAR_COMPROBANTE', 'DISPUTA', 'SOLICITUD_PLAZO', 'CONTACTO_SOLICITADO', 'OTRO'] as const;
    for (const k of kinds) {
      expect(humanTaskTitle(k, 'SPOS-9')).toContain('SPOS-9');
    }
  });
});

// Guardas de exhaustividad: si alguien agrega un intent, estos fallan hasta
// completar el mapeo (el catálogo debe seguir CERRADO y total).
describe('exhaustividad del catálogo', () => {
  it('cada intent tiene agentAction no vacío', () => {
    for (const intent of CARTERA_INTENTS as readonly CarteraIntent[]) {
      expect(INTENT_ACTIONS[intent].agentAction.length).toBeGreaterThan(0);
    }
  });
});
