import 'server-only';

// Agente de cartera: canal ENTRANTE → intent → acción determinista (§B15b).
// Dos piezas:
//   1. classifyCarteraIntent: el ÚNICO uso del modelo. Salida CERRADA (enum de
//      CARTERA_INTENTS + fecha de promesa opcional). El modelo solo clasifica.
//      Modelo: autoModel() de la fábrica de Athos (default claude-haiku-4-5,
//      configurable por env) — nunca hardcodeado, misma semántica del cliente.
//   2. executeCarteraInbound: ejecuta la acción del mapeo puro (intents.ts)
//      sobre la BD — registra el entrante en comm_messages, dispara
//      eventos/tareas y refresca el estado derivado. La respuesta es una
//      plantilla fija. (En el cliente se llamaba applyCarteraInbound; acá ese
//      nombre lo lleva el router de wa-router.ts que exige el contrato.)
//
// Doctrina: el agente nunca modifica facturas, monta notas crédito, concede
// plazos ni concilia pagos. Todo eso queda como tarea humana.

import { generateObject } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { autoModel } from '@/lib/athos-agent/model';
import { registrarUso } from '@/lib/athos-agent/usage';
import { consultarPresupuesto } from '@/lib/athos-agent/presupuesto';
import { getAppBaseUrl } from '@/lib/base-url';
import { refreshInvoiceStatus } from '@/lib/facturacion/invoices';
import type { CommsChannel } from '@/lib/supabase/types';
import {
  CARTERA_INTENTS,
  INTENT_ACTIONS,
  humanTaskTitle,
  renderReply,
  type CarteraIntent,
} from './intents';
import { clinicaPuede } from '@/lib/planes/servidor';
import { revokeAuthorization } from './authorizations';
import { openHumanTask } from './tasks';

export interface IntentClassification {
  intent: CarteraIntent;
  /** Fecha de la promesa de pago (YYYY-MM-DD) si el intent es PROMESA_PAGO. */
  promiseDate: string | null;
}

/**
 * Clasifica un mensaje entrante del cliente en UN intent cerrado. El modelo NO
 * decide acciones ni redacta respuestas: solo etiqueta. `todayISO` ancla las
 * fechas relativas ("el viernes", "en 3 días") a la zona del negocio.
 */
export async function classifyCarteraIntent(
  text: string,
  opts: { todayISO: string; clinicId: string },
): Promise<IntentClassification> {
  // TOPE MENSUAL DE IA DE LA CLÍNICA, antes de gastar. Cartera es —junto con el modo automático de
  // WhatsApp— la superficie que más gasta sin que nadie la mire: corre en un barrido diario y
  // clasifica cada respuesta del cliente con el modelo. Dejarla fuera del tope sería dejar el
  // agujero justo donde está el consumo invisible.
  //
  // Sin cupo se degrada a `OTRO`, que es exactamente lo mismo que hace cuando el clasificador
  // falla: escala a una persona y no se responde nada automático. El cobro no se pierde — lo
  // atiende un humano.
  // EL PLAN PRIMERO. La clasificación de intents es de Pro: corre en el barrido diario, sin sesión
  // y sin nadie delante, y gasta una llamada al modelo por cada respuesta de cliente.
  //
  // Degrada a `OTRO` en vez de romper, igual que sin cupo. **Cartera sigue funcionando en free**:
  // los recordatorios salen, la antigüedad se calcula, los cobros se registran. Lo único que se
  // pierde es que una máquina lea la respuesta primero — la lee una persona, que es como funcionaba
  // antes de que existiera el clasificador.
  if (!(await clinicaPuede(opts.clinicId, 'cartera-ia'))) {
    return { intent: 'OTRO', promiseDate: null };
  }

  const presupuesto = await consultarPresupuesto(opts.clinicId);
  if (!presupuesto.permitido) {
    console.warn(
      `[cartera/inbound] clínica ${opts.clinicId} sin cupo de IA este mes (${presupuesto.usadas}/${presupuesto.tope}): el mensaje escala a una persona.`,
    );
    return { intent: 'OTRO', promiseDate: null };
  }

  // Una sola resolución del modelo: la misma instancia atiende y, abajo, dice quién respondió si
  // la cascada tuvo que caer al respaldo.
  const elegido = autoModel();

  const schema = z.object({
    intent: z.enum(CARTERA_INTENTS),
    promiseDate: z
      .string()
      .nullable()
      .describe(
        'Solo si el intent es PROMESA_PAGO y el cliente da una fecha concreta: fecha ISO YYYY-MM-DD. En cualquier otro caso, null.',
      ),
  });

  try {
    const { object, usage } = await generateObject({
      model: elegido.model,
      maxOutputTokens: 128,
      schema,
      system:
        'Eres un clasificador de mensajes de un agente de COBRANZA de una clínica veterinaria en Colombia. ' +
        'El cliente responde a un recordatorio de una factura con saldo pendiente. Clasifica su mensaje en EXACTAMENTE ' +
        'uno de estos intents:\n' +
        '- YA_PAGUE: dice que ya pagó / ya transfirió / adjunta o menciona comprobante.\n' +
        '- PROMESA_PAGO: se compromete a pagar en una fecha ("le transfiero el viernes", "el 20 pago").\n' +
        '- PEDIR_ENLACE: pide el enlace, el link, la factura o cómo pagar.\n' +
        '- DISPUTA: no reconoce la factura, dice que el valor está equivocado o que no debe.\n' +
        '- SOLICITUD_PLAZO: pide más tiempo/plazo/prórroga sin comprometerse a una fecha concreta.\n' +
        '- CONTACTO_HUMANO: pide hablar con una persona, con el doctor o con alguien de la clínica.\n' +
        '- OPT_OUT: pide que no le escriban más, que lo saquen de la lista, que dejen de molestar.\n' +
        '- OTRO: cualquier otra cosa o mensaje ambiguo.\n' +
        `Hoy es ${opts.todayISO} (America/Bogota). Convierte fechas relativas a YYYY-MM-DD. ` +
        'Ante la duda entre PROMESA_PAGO y SOLICITUD_PLAZO, si NO hay fecha concreta usa SOLICITUD_PLAZO.',
      prompt: `Mensaje del cliente:\n"""\n${text.slice(0, 1500)}\n"""`,
    });

    void registrarUso({
      clinicId: opts.clinicId,
      userId: null, // cobranza automática: no hay vet detrás
      surface: 'cartera_inbound',
      elegido,
      usage,
    });

    return { intent: object.intent, promiseDate: object.promiseDate ?? null };
  } catch {
    // Si el clasificador falla, degradar a OTRO (escala a humano, sin respuesta).
    return { intent: 'OTRO', promiseDate: null };
  }
}

export interface CarteraInboundInput {
  channel: CommsChannel;
  ownerId: string;
  invoiceId: string;
  /** full_number visible de la factura. */
  invoiceNumber: string;
  shareToken: string;
  incomingText: string;
  classification: IntentClassification;
  /** Vínculo de origen para auditar el hilo (id de conversación si existiera). */
  waConversationId?: string | null;
  now?: Date;
}

export interface CarteraInboundResult {
  intent: CarteraIntent;
  agentAction: string;
  /** Respuesta a enviar (plantilla fija) o null si no hay respuesta automática. */
  reply: string | null;
  commMessageId: string;
}

/**
 * Ejecuta la acción determinista de un mensaje entrante ya clasificado. Registra
 * el entrante en comm_messages (direction=ENTRANTE, intent, agent_action),
 * dispara eventos/tareas y refresca el estado. Devuelve la respuesta a enviar.
 */
export async function executeCarteraInbound(
  supabase: SupabaseClient,
  clinicId: string,
  input: CarteraInboundInput,
): Promise<CarteraInboundResult> {
  const { intent, promiseDate } = input.classification;
  const spec = INTENT_ACTIONS[intent];
  const now = input.now ?? new Date();
  const link = `${getAppBaseUrl()}/f/${input.shareToken}`;

  // Promesa de pago SIN fecha: no se puede registrar → se trata como solicitud
  // de plazo (escala a humano) y se pide la fecha. Nunca inventa una fecha.
  const promiseWithoutDate = intent === 'PROMESA_PAGO' && !promiseDate;

  // 1. Registrar el entrante en el outbox unificado (auditable).
  const { data: cm, error: cmErr } = await supabase
    .from('comm_messages')
    .insert({
      clinic_id: clinicId,
      invoice_id: input.invoiceId,
      owner_id: input.ownerId,
      channel: input.channel,
      direction: 'ENTRANTE',
      to_address: null,
      template: null,
      body: input.incomingText,
      status: 'ENTREGADO',
      intent,
      agent_action: promiseWithoutDate ? 'PROMESA_SIN_FECHA' : spec.agentAction,
      wa_conversation_id: input.waConversationId ?? null,
    })
    .select('id')
    .single();
  if (cmErr) throw new Error(`No se pudo registrar el mensaje entrante: ${cmErr.message}`);
  const commId = (cm as { id: string }).id;

  // 2. Efectos deterministas del mapeo.
  if (spec.event === 'PROMISE_TO_PAY' && promiseDate) {
    await supabase.from('invoice_events').insert({
      invoice_id: input.invoiceId,
      event_type: 'PROMISE_TO_PAY',
      payload: { until: `${promiseDate}T23:59:59`, source: 'AGENTE_CARTERA', commId },
    });
  } else if (spec.event === 'DISPUTE_OPENED') {
    await supabase.from('invoice_events').insert({
      invoice_id: input.invoiceId,
      event_type: 'DISPUTE_OPENED',
      payload: { source: 'AGENTE_CARTERA', commId },
    });
  }

  if (spec.pauseReminders) {
    await supabase.from('invoice_events').insert({
      invoice_id: input.invoiceId,
      event_type: 'REMINDERS_PAUSED',
      payload: { source: 'AGENTE_CARTERA', intent, commId },
    });
  }

  if (spec.revokeChannel) {
    await revokeAuthorization(supabase, clinicId, {
      ownerId: input.ownerId,
      channel: input.channel,
      invoiceId: input.invoiceId,
    });
  }

  // Tarea humana (del mapeo, o la de "promesa sin fecha").
  const taskKind = promiseWithoutDate ? 'SOLICITUD_PLAZO' : spec.task;
  if (taskKind) {
    await openHumanTask(supabase, clinicId, {
      kind: taskKind,
      invoiceId: input.invoiceId,
      ownerId: input.ownerId,
      title: humanTaskTitle(taskKind, input.invoiceNumber),
      payload: { intent, text: input.incomingText.slice(0, 500), commId },
    });
  }

  // 3. Refrescar el estado derivado (recaudo + seguimiento).
  await refreshInvoiceStatus(supabase, clinicId, input.invoiceId, now);

  // 4. Respuesta (plantilla fija; nunca del modelo).
  let reply: string | null = null;
  if (promiseWithoutDate) {
    reply = renderReply('PROMESA_SIN_FECHA', { number: input.invoiceNumber, link });
  } else if (spec.reply) {
    reply = renderReply(spec.reply, { number: input.invoiceNumber, link, promiseDate });
  }

  return {
    intent,
    agentAction: promiseWithoutDate ? 'PROMESA_SIN_FECHA' : spec.agentAction,
    reply,
    commMessageId: commId,
  };
}
