import 'server-only';

// Las respuestas de los titulares a una factura, leídas por Composio.
//
// REEMPLAZA EL BARRIDO IMAP (`lib/email/sync.ts`). El circuito viejo abría el buzón de la clínica con
// una contraseña de aplicación de Gmail; esa cuenta se retiró —las facturas salen por el correo de
// Tuvetia— y con ella se fue la única vía de entrada del correo. Sin esto, un titular que contesta
// "ya pagué" por correo es invisible para cobranza.
//
// POR QUÉ EL BUZÓN DEL ADMINISTRADOR. El transaccional pone `Reply-To` a los admins de la clínica
// (`email/transactional.ts:79`), así que la respuesta aterriza ahí y en ningún otro lado. Y ese
// buzón YA está conectado por Composio para que Athos escriba por ellos: no hay credencial nueva que
// pedir ni cuenta nueva que configurar. La arquitectura se cierra sola.
//
// CÓMO SE ATRIBUYE UNA RESPUESTA A SU FACTURA. Por ASUNTO, no por cabeceras. La API del proveedor no
// entrega `References`/`In-Reply-To` —el circuito IMAP sí los tenía, y por eso usaba
// `belongsToThread`—, así que se compara `asuntoBase()` contra `invoice_email_threads.subject`. Es
// suficiente porque el asunto lleva el `full_number`, que es único por clínica.
//
// LO QUE ESTE CAMINO NO PUEDE HACER, Y HAY QUE SABERLO. La API entrega la CANTIDAD de adjuntos, no
// los bytes: un comprobante de pago se detecta y se escala a una persona, pero no se guarda como
// archivo. El circuito IMAP sí los bajaba. Es una pérdida real y consciente — descargarlos exige
// otra tool del proveedor por adjunto, y va en su propio trabajo.

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { asuntoBase, replySubject } from '@/lib/email/threading';
import { buscarCorreos, composioConfigurado, responderCorreo } from '@/lib/composio/correo';
import type { CorreoNormalizado } from '@/lib/composio/correo';
import { classifyCarteraIntent, executeCarteraInbound } from './inbound';
import { humanTaskTitle } from './intents';
import { openHumanTask } from './tasks';
import { bogotaTodayISO } from '@/lib/date-utils';

export type ResultadoRespuestas = {
  clinicas: number;
  leidos: number;
  atribuidos: number;
  respondidos: number;
  comprobantes: number;
};

type Hilo = {
  id: string;
  invoice_id: string;
  subject: string | null;
  to_email: string;
  last_inbound_at: string | null;
  created_at: string;
};

type Factura = {
  id: string;
  full_number: string | null;
  share_token: string;
  balance_cents: number;
  status: string;
  followup_enabled: boolean;
  payer_id: string | null;
};

/** Cuántos correos recientes se miran por administrador. */
const LIMITE_POR_BUZON = 40;

/**
 * Barre el buzón de UN administrador buscando respuestas a las facturas de SU clínica.
 *
 * Nunca lanza hacia afuera: un buzón que falla no puede frenar a los demás — misma doctrina que
 * `runCarteraForAllClinics`.
 */
async function barrerBuzon(
  admin: SupabaseClient,
  clinicId: string,
  adminUserId: string,
  hilos: Hilo[],
  total: ResultadoRespuestas,
): Promise<void> {
  // Se piden los recientes sin filtro de asunto: una sola llamada por buzón en vez de una por
  // factura. Con `LIMITE_POR_BUZON` correos y el barrido diario, una respuesta se pierde sólo si
  // ese administrador recibió más de 40 correos ese día DESPUÉS de la respuesta — y en ese caso
  // igual quedará la tarea humana del recordatorio siguiente.
  const r = await buscarCorreos(adminUserId, { limite: LIMITE_POR_BUZON });
  if (!r.ok) {
    // `sinConectar` es el estado normal de un admin que todavía no vinculó su correo: no es un error
    // que valga la pena gritar en cada barrido.
    if (!r.sinConectar) {
      console.error(`[cartera/correo] clinic=${clinicId} no se pudo leer el buzón:`, r.error);
    }
    return;
  }
  total.leidos += r.correos.length;

  // Índice por asunto normalizado. Si dos hilos comparten asunto (no debería: el número de factura
  // es único), gana el más reciente, que es el que el titular tiene delante.
  const porAsunto = new Map<string, Hilo>();
  for (const h of hilos) {
    const clave = asuntoBase(h.subject);
    if (clave) porAsunto.set(clave, h);
  }

  for (const correo of r.correos) {
    if (correo.esPropio) continue; // lo que mandó el propio admin no es una respuesta del titular
    const hilo = porAsunto.get(asuntoBase(correo.asunto));
    if (!hilo) continue; // correo ajeno a Tuvetia: el buzón del admin es su buzón de todo

    // Cursor por hilo: sólo lo posterior a la última respuesta ya procesada. Sin esto, cada barrido
    // volvería a clasificar y a responder el mismo correo — y el titular recibiría el mismo mensaje
    // todos los días.
    const desde = hilo.last_inbound_at ?? hilo.created_at;
    if (new Date(correo.fecha).getTime() <= new Date(desde).getTime()) continue;

    total.atribuidos += 1;
    await procesar(admin, clinicId, adminUserId, hilo, correo, total);

    // Avanza SIEMPRE, incluso si el procesamiento falló a medias: preferimos una respuesta perdida
    // —que queda visible en la tarea humana— a un buzón que se reprocesa en bucle.
    const nuevo = correo.fecha;
    await admin
      .from('invoice_email_threads')
      .update({ last_inbound_at: nuevo, updated_at: new Date().toISOString() })
      .eq('id', hilo.id)
      .eq('clinic_id', clinicId);
    hilo.last_inbound_at = nuevo;
  }
}

async function procesar(
  admin: SupabaseClient,
  clinicId: string,
  adminUserId: string,
  hilo: Hilo,
  correo: CorreoNormalizado,
  total: ResultadoRespuestas,
): Promise<void> {
  try {
    // La factura tiene que seguir cobrable — mismo criterio que `wa-router`.
    const { data: invRow } = await admin
      .from('invoices')
      .select('id, full_number, share_token, balance_cents, status, followup_enabled, payer_id')
      .eq('clinic_id', clinicId)
      .eq('id', hilo.invoice_id)
      .maybeSingle();
    const factura = invRow as Factura | null;
    if (
      !factura ||
      factura.status !== 'EMITIDA' ||
      factura.balance_cents <= 0 ||
      !factura.followup_enabled
    ) {
      return;
    }

    // El titular sale del pagador de la factura: un correo no trae teléfono con el que buscarlo.
    let ownerId: string | null = null;
    if (factura.payer_id) {
      const { data: payer } = await admin
        .from('billing_payers')
        .select('owner_id')
        .eq('clinic_id', clinicId)
        .eq('id', factura.payer_id)
        .maybeSingle();
      ownerId = (payer as { owner_id: string | null } | null)?.owner_id ?? null;
    }

    const conAdjunto = correo.adjuntos > 0;
    const texto =
      correo.cuerpo.trim() ||
      correo.preview.trim() ||
      (conAdjunto ? '(el cliente envió un archivo adjunto, probablemente un comprobante)' : '');
    if (!texto && !conAdjunto) return;

    const classification = await classifyCarteraIntent(texto, {
      todayISO: bogotaTodayISO(),
      clinicId,
    });

    const inbound = await executeCarteraInbound(admin, clinicId, {
      channel: 'EMAIL',
      ownerId: ownerId ?? '',
      invoiceId: factura.id,
      invoiceNumber: factura.full_number ?? '',
      shareToken: factura.share_token,
      incomingText: texto,
      classification,
      waConversationId: null,
    });

    // Adjunto → tarea de verificación, SIN el archivo. No se puede hacer más por este camino (ver la
    // nota de la cabecera), y una tarea sin adjunto es mucho mejor que un pago que nadie mira: la
    // persona entra al correo del administrador, que es donde está.
    if (conAdjunto) {
      await openHumanTask(admin, clinicId, {
        kind: 'VERIFICAR_COMPROBANTE',
        invoiceId: factura.id,
        ownerId,
        title: humanTaskTitle('VERIFICAR_COMPROBANTE', factura.full_number ?? ''),
        payload: { source: 'CORREO', enlace: correo.enlace, de: correo.de },
      });
      total.comprobantes += 1;
    }

    // La respuesta del catálogo sale por el MISMO buzón que la recibió, dentro del hilo.
    if (inbound.reply) {
      const envio = await responderCorreo(adminUserId, {
        ref: correo.refRespuesta,
        a: correo.de,
        asunto: replySubject(hilo.subject),
        cuerpo: inbound.reply,
      });
      if (envio.ok) total.respondidos += 1;
      else console.error(`[cartera/correo] no se pudo responder a ${correo.de}:`, envio.error);
    }
  } catch (e) {
    // Un correo que no se pudo procesar no frena el resto del buzón.
    console.error(`[cartera/correo] clinic=${clinicId} correo=${correo.id} falló:`, e);
  }
}

/**
 * Lee las respuestas por correo de todas las clínicas que tengan facturas con hilo abierto.
 *
 * Lo llama el cron de cartera (piggyback: el plan Hobby permite 2 crons y los 2 cupos están usados).
 */
export async function leerRespuestasDeCorreo(): Promise<ResultadoRespuestas> {
  const total: ResultadoRespuestas = {
    clinicas: 0,
    leidos: 0,
    atribuidos: 0,
    respondidos: 0,
    comprobantes: 0,
  };
  if (!composioConfigurado()) return total;

  const admin = createAdminClient();

  // Se arranca por los hilos y no por las clínicas: una clínica sin facturas enviadas por correo no
  // tiene nada que barrer, y abrir su buzón sería gastar una llamada al proveedor por nada.
  const { data: hiloRows, error } = await admin
    .from('invoice_email_threads')
    .select('id, clinic_id, invoice_id, subject, to_email, last_inbound_at, created_at');
  if (error) {
    console.error('[cartera/correo] no se pudieron leer los hilos:', error.message);
    return total;
  }
  const hilos = (hiloRows ?? []) as (Hilo & { clinic_id: string })[];
  if (hilos.length === 0) return total;

  const porClinica = new Map<string, Hilo[]>();
  for (const h of hilos) {
    const lista = porClinica.get(h.clinic_id);
    if (lista) lista.push(h);
    else porClinica.set(h.clinic_id, [h]);
  }
  total.clinicas = porClinica.size;

  for (const [clinicId, susHilos] of porClinica) {
    try {
      // Los administradores son quienes reciben las respuestas (son el Reply-To). Se barren TODOS
      // los que tengan correo conectado: si la clínica tiene dos admins, la respuesta puede haber
      // caído en cualquiera de los dos buzones.
      const { data: adminRows } = await admin
        .from('profiles')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('role', 'admin');
      const adminIds = ((adminRows ?? []) as { id: string }[]).map((p) => p.id);

      for (const adminUserId of adminIds) {
        await barrerBuzon(admin, clinicId, adminUserId, susHilos, total);
      }
    } catch (e) {
      console.error(`[cartera/correo] clinic=${clinicId} barrido fallido:`, e);
    }
  }

  return total;
}
