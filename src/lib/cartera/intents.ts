// Catálogo CERRADO de intenciones del agente de cartera (§4.4 / §B15b) y su
// mapeo determinista a acciones. Módulo PURO (sin DB ni modelo): el clasificador
// IA solo elige un intent de esta lista; la ACCIÓN nunca la decide el modelo,
// sale de esta tabla. El agente jamás modifica facturas, monta notas crédito,
// concede plazos ni concilia pagos: solo clasifica, responde con plantilla fija
// y abre tareas para una persona.

import type { HumanTaskKind } from '@/lib/supabase/types';

export const CARTERA_INTENTS = [
  'YA_PAGUE', // «ya pagué»
  'PROMESA_PAGO', // «le transfiero el <fecha>»
  'PEDIR_ENLACE', // «envíeme el enlace»
  'DISPUTA', // «no reconozco esta factura» / «valor equivocado»
  'SOLICITUD_PLAZO', // «necesito más plazo»
  'CONTACTO_HUMANO', // «quiero hablar con alguien»
  'OPT_OUT', // «no me escriban más»
  'OTRO', // no clasificable
] as const;
export type CarteraIntent = (typeof CARTERA_INTENTS)[number];

export type IntentReplyKey =
  | 'PEDIR_COMPROBANTE'
  | 'PROMESA_OK'
  | 'PROMESA_SIN_FECHA'
  | 'ENLACE'
  | 'DISPUTA_OK'
  | 'PLAZO_RECIBIDO'
  | 'CONTACTO_OK'
  | 'OPT_OUT_OK';

/** Qué hace el sistema ante un intent. Todo booleano/enum, cero libre albedrío. */
export interface IntentAction {
  /** Tarea humana a abrir (o null). */
  task: HumanTaskKind | null;
  /** Evento de factura a registrar (el estado se DERIVA, no se setea). */
  event: 'PROMISE_TO_PAY' | 'DISPUTE_OPENED' | null;
  /** ¿Pausar recordatorios? (evento REMINDERS_PAUSED). */
  pauseReminders: boolean;
  /** ¿Revocar la autorización del canal por el que llegó el mensaje? */
  revokeChannel: boolean;
  /** ¿Reenviar el enlace público de la factura? */
  resendLink: boolean;
  /** Plantilla de respuesta (o null = sin respuesta automática). */
  reply: IntentReplyKey | null;
  /** Etiqueta corta y estable de la acción (queda en comm_messages.agent_action). */
  agentAction: string;
}

export const INTENT_ACTIONS: Record<CarteraIntent, IntentAction> = {
  YA_PAGUE: {
    task: 'VERIFICAR_COMPROBANTE',
    event: null,
    pauseReminders: true,
    revokeChannel: false,
    resendLink: false,
    reply: 'PEDIR_COMPROBANTE',
    agentAction: 'ABRIR_VERIFICAR_COMPROBANTE',
  },
  PROMESA_PAGO: {
    task: null,
    event: 'PROMISE_TO_PAY',
    pauseReminders: false, // la promesa ya pausa vía deriveStatus (EN_PROMESA_DE_PAGO)
    revokeChannel: false,
    resendLink: false,
    reply: 'PROMESA_OK',
    agentAction: 'REGISTRAR_PROMESA',
  },
  PEDIR_ENLACE: {
    task: null,
    event: null,
    pauseReminders: false,
    revokeChannel: false,
    resendLink: true,
    reply: 'ENLACE',
    agentAction: 'REENVIAR_ENLACE',
  },
  DISPUTA: {
    task: 'DISPUTA',
    event: 'DISPUTE_OPENED',
    pauseReminders: false, // la disputa ya detiene vía deriveStatus (EN_DISPUTA)
    revokeChannel: false,
    resendLink: false,
    reply: 'DISPUTA_OK',
    agentAction: 'ABRIR_DISPUTA',
  },
  SOLICITUD_PLAZO: {
    task: 'SOLICITUD_PLAZO',
    event: null,
    pauseReminders: false, // el agente NO concede plazos: solo escala
    revokeChannel: false,
    resendLink: false,
    reply: 'PLAZO_RECIBIDO',
    agentAction: 'ABRIR_SOLICITUD_PLAZO',
  },
  CONTACTO_HUMANO: {
    task: 'CONTACTO_SOLICITADO',
    event: null,
    pauseReminders: true,
    revokeChannel: false,
    resendLink: false,
    reply: 'CONTACTO_OK',
    agentAction: 'ABRIR_CONTACTO_SOLICITADO',
  },
  OPT_OUT: {
    task: null,
    event: null,
    pauseReminders: false,
    revokeChannel: true, // revoca el canal; si no queda ninguno → seguimiento CANCELADO
    resendLink: false,
    reply: 'OPT_OUT_OK',
    agentAction: 'REVOCAR_CANAL',
  },
  OTRO: {
    task: 'OTRO',
    event: null,
    pauseReminders: false,
    revokeChannel: false,
    resendLink: false,
    reply: null, // no clasificable → sin respuesta automática, solo escala
    agentAction: 'ABRIR_OTRO',
  },
};

export interface ReplyContext {
  /** Número visible de la factura (full_number). */
  number: string;
  /** Enlace público absoluto /f/<token>. */
  link: string;
  /** Fecha de la promesa (YYYY-MM-DD), si aplica. */
  promiseDate?: string | null;
}

/** Respuesta fija por plantilla. NUNCA la redacta el modelo. */
export function renderReply(key: IntentReplyKey, ctx: ReplyContext): string {
  switch (key) {
    case 'PEDIR_COMPROBANTE':
      return 'Gracias por avisarnos. Para confirmar su pago, ¿podría enviarnos el comprobante de la transferencia por este medio? Apenas lo verifiquemos, cerramos el saldo.';
    case 'PROMESA_OK':
      return `Perfecto, registramos su compromiso de pago${ctx.promiseDate ? ` para el ${ctx.promiseDate}` : ''}. Pausamos los recordatorios hasta esa fecha. ¡Gracias!`;
    case 'PROMESA_SIN_FECHA':
      return '¿Para qué fecha estima realizar el pago? Con esa fecha registramos su compromiso y pausamos los recordatorios hasta entonces.';
    case 'ENLACE':
      return `Con gusto. Aquí está el enlace de su factura ${ctx.number}: ${ctx.link}`;
    case 'DISPUTA_OK':
      return `Entendido. Registramos su inquietud sobre la factura ${ctx.number}; una persona de la clínica la revisará y suspendemos los recordatorios mientras tanto.`;
    case 'PLAZO_RECIBIDO':
      return 'Recibimos su solicitud. Una persona de la clínica evaluará un nuevo plazo y le confirmará. Por ahora la factura sigue vigente.';
    case 'CONTACTO_OK':
      return 'Claro, una persona de la clínica se pondrá en contacto con usted. Pausamos los mensajes automáticos por este medio.';
    case 'OPT_OUT_OK':
      return 'Entendido, no le enviaremos más recordatorios por este medio. Si necesita algo, puede escribirnos cuando quiera.';
  }
}

/** Título de la tarea humana escalada, por tipo. */
export function humanTaskTitle(kind: HumanTaskKind, invoiceNumber: string): string {
  switch (kind) {
    case 'VERIFICAR_COMPROBANTE':
      return `Verificar comprobante de pago — ${invoiceNumber}`;
    case 'DISPUTA':
      return `Cliente no reconoce la factura ${invoiceNumber}`;
    case 'SOLICITUD_PLAZO':
      return `Solicitud de más plazo — ${invoiceNumber}`;
    case 'CONTACTO_SOLICITADO':
      return `Cliente pidió hablar con una persona — ${invoiceNumber}`;
    case 'MENSAJE_NO_ENTREGADO':
      return `No se pudo entregar el recordatorio de ${invoiceNumber}`;
    case 'OTRO':
      return `Mensaje del cliente sobre ${invoiceNumber}`;
  }
}
