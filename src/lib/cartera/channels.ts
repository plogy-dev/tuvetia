import 'server-only';

// Adaptador de mensajería REAL de cartera. Reemplaza a SimulatedMessaging
// detrás del puerto MessagingPort SIN tocar el scheduler.
//
// Adaptación del port (contrato §5):
//   · WhatsApp → sendWhatsAppText de @/lib/whatsapp/send-message (el ÚNICO
//     camino de salida del destino; el transporte ya aplica cadencia humana).
//     SIN plantillas Meta: el texto del recordatorio llega ya redactado en
//     msg.body. El saliente queda registrado en whatsapp_messages por el
//     propio sendWhatsAppText (agent_mode 'auto', sent_by null = sistema).
//   · Email → sendTransactionalEmail (Resend, desde el correo de Tuvetia con el
//     nombre de la clínica). connectedChannels lo reporta si hay RESEND_API_KEY;
//     si no, el scheduler salta el canal con log, como antes. Antes salía por el
//     SMTP de la clínica con su contraseña de aplicación: esa cuenta se retiró.
//
// Nunca decide A QUIÉN ni CUÁNDO contactar (eso es del gate Ley 2300 en el
// dominio): solo materializa el envío que el despachador ya autorizó.

import { maquetarCorreo, parrafosDeTexto } from '@/lib/email/maqueta';
import { resendApiKey } from '@/lib/email/resend';
import { sendTransactionalEmail, transactionalFrom } from '@/lib/email/transactional';
import { buildMessageId } from '@/lib/email/threading';
import { DestinoNoRegistrado } from '@/lib/whatsapp/destino-permitido';
import { loadIntegration, sendWhatsAppText } from '@/lib/whatsapp/send-message';
import type { CommsChannel } from '@/lib/supabase/types';
import { SimulatedMessaging, type MessagingPort, type OutboundMessage, type SendResult } from './messaging';

function fail(error: string, transient = false): SendResult {
  return { ok: false, provider: 'REAL', providerMessageId: null, status: 'FALLIDO', error, transient };
}

/** La primera dirección web del texto. El `)` queda afuera para no comerse el de "(pague en …)". */
const URL_EN_EL_TEXTO = /https?:\/\/[^\s<>"')]+/;

/**
 * Separa el enlace de pago del texto del recordatorio, para poder dibujarlo como botón.
 *
 * El cuerpo llega redactado por la CLÍNICA (`{link}` ya reemplazado, ver `cartera/plantillas.ts`),
 * así que el enlace viene metido dentro de la frase y no como un campo aparte. En correo eso es un
 * problema: el titular tiene que apretar algo, no copiar una dirección de una oración.
 *
 * SÓLO SE SACA DEL TEXTO SI CIERRA EL MENSAJE, que es la forma de las cinco plantillas por defecto
 * y de casi todo lo que se escribe («Pague aquí: <enlace>»). Si el enlace está en el medio de una
 * oración, el texto queda intacto y el botón se agrega igual: mostrar la dirección dos veces es
 * feo, pero cortarle la frase a un mensaje de cobranza —que la clínica redactó y del que responde
 * ante la Ley 2300— es peor.
 */
function separarEnlaceDePago(body: string): { cuerpo: string; url: string | null } {
  const m = body.match(URL_EN_EL_TEXTO);
  if (!m || m.index === undefined) return { cuerpo: body, url: null };
  // El punto final de la oración no es parte de la dirección.
  const url = m[0].replace(/[.,;:!?]+$/, '');
  const resto = body.slice(m.index + url.length);
  const cierraElMensaje = /^[\s.,;:!?]*$/.test(resto);
  return { cuerpo: cierraElMensaje ? body.slice(0, m.index).trimEnd() : body, url };
}

/** Lo que la bandeja muestra al lado del asunto: el arranque del propio recordatorio. */
function primerasPalabras(texto: string): string {
  const linea = texto.replace(/\s+/g, ' ').trim();
  if (linea.length <= 140) return linea;
  return `${linea.slice(0, 139).replace(/\s+\S*$/, '')}…`;
}

export class RealMessaging implements MessagingPort {
  readonly name = 'REAL';
  constructor(private readonly clinicId: string) {}

  async connectedChannels(): Promise<CommsChannel[]> {
    const channels: CommsChannel[] = [];

    const integ = await loadIntegration(this.clinicId);
    if (integ && integ.status === 'connected') channels.push('WHATSAPP');

    // El correo de cobranza es TRANSACCIONAL: sale del remitente de Tuvetia firmado con el nombre
    // de la clínica (ver CORREOS.md). Ya no depende de que cada clínica configure su SMTP —antes
    // era el motivo #1 por el que la cobranza terminaba siendo sólo WhatsApp—, así que el canal
    // está disponible para todas mientras Tuvetia tenga su remitente configurado.
    //
    // Esto NO decide si se contacta a alguien: eso sigue siendo del gate de la Ley 2300 (ventana
    // horaria, un contacto por día, canal autorizado) dentro del dominio.
    if (resendApiKey()) channels.push('EMAIL');
    else
      console.log(
        `[cartera/channels] clinic=${this.clinicId} canal EMAIL omitido: falta RESEND_API_KEY`,
      );
    return channels;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!msg.to?.trim()) return fail('Destino vacío');
    try {
      if (msg.channel === 'EMAIL') return await this.sendEmail(msg);
      return await this.sendWhatsApp(msg);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error de envío';
      // "WhatsApp no está conectado" → transitorio (no perder el recordatorio:
      // el despachador reprograma en vez de omitir).
      const transient = /no está conectado|no esta conectado/i.test(message);
      return fail(message, transient);
    }
  }

  /**
   * Recordatorio de cobranza por correo.
   *
   * Sale por el remitente TRANSACCIONAL de Tuvetia (vet@tuvetia.com), firmado con el nombre de la
   * clínica y con Reply-To a sus administradores — ver CORREOS.md. `sendTransactionalEmail` devuelve
   * `transient` distinguiendo un fallo de red o un 429 —reprogramable— de uno de configuración
   * (dominio sin verificar, clave revocada). El despachador usa esa distinción para no perder el
   * recordatorio.
   *
   * El asunto y el cuerpo llegan ya redactados en `msg`: este adaptador NO decide qué decir, ni a
   * quién, ni cuándo — eso es del gate de la Ley 2300 en el dominio. Lo único que hace con el texto
   * es MAQUETARLO: las mismas palabras, dentro de la envoltura de marca y con el enlace de pago
   * como botón. Nada se reescribe.
   */
  private async sendEmail(msg: OutboundMessage): Promise<SendResult> {
    // Message-ID propio: es la raíz del hilo y lo que permite reconocer la respuesta del titular
    // cuando entra por IMAP. Sin él, la respuesta llegaría como un correo suelto sin conversación.
    const messageId = buildMessageId(
      msg.invoiceId ?? this.clinicId,
      transactionalFrom(),
      `${Date.now()}`,
    );

    const subject = msg.subject?.trim() || 'Recordatorio de pago';
    // EL TEXTO DE LA CLÍNICA ES DATO, NO HTML. Lo escribe un vet en la pantalla de plantillas de
    // recordatorio y puede traer cualquier carácter; entra como párrafos y `maquetarCorreo` lo
    // escapa. Concatenarlo crudo en el HTML sería dejar que un `<` de una plantilla desarme el
    // correo, y peor, que lo escrito en una pantalla de configuración termine siendo marcado.
    //
    // Los saltos de línea de la plantilla se respetan: línea en blanco parte párrafo, salto simple
    // queda como corte de línea dentro del párrafo.
    const { cuerpo, url } = separarEnlaceDePago(msg.body);
    const parrafos = parrafosDeTexto(cuerpo);
    const html = maquetarCorreo({
      titulo: subject,
      preheader: primerasPalabras(parrafos[0] ?? subject),
      parrafos,
      boton: url ? { texto: 'Ver y pagar la factura', url } : null,
    });

    const r = await sendTransactionalEmail(this.clinicId, {
      to: msg.to,
      subject,
      html,
      messageId,
    });
    if (!r.ok) return fail(r.error ?? 'Error de envío de correo', r.transient ?? false);
    return { ok: true, provider: 'email', providerMessageId: r.id, status: 'ENVIADO' };
  }

  private async sendWhatsApp(msg: OutboundMessage): Promise<SendResult> {
    try {
      const { waMessageId } = await sendWhatsAppText(this.clinicId, msg.to, msg.body, {
        ownerId: msg.ownerId ?? null,
        sentBy: null, // lo envió el motor de cartera, no un humano
        agentMode: 'auto',
        origen: 'athos', // el motor eligió el destinatario, no una persona
      });
      return { ok: true, provider: 'whatsapp', providerMessageId: waMessageId, status: 'ENVIADO' };
    } catch (e) {
      // EL DESTINO NO ESTÁ REGISTRADO como titular. Cartera le escribe a un pagador que puede no
      // estar cargado en el CRM, y eso es Athos escribiendo — el cerco aplica.
      //
      // SE TRADUCE A FALLO NO TRANSITORIO, y eso no es un detalle de tipos: `transient: false` es
      // lo que hace que el scheduler abra una tarea `MENSAJE_NO_ENTREGADO` (§ `procesarRecordatorios`)
      // en vez de reprogramar el recordatorio para mañana. Reprogramarlo sería reintentar todos los
      // días algo que va a fallar siempre — y en silencio, porque nadie mira los logs de un cron.
      //
      // Así el vet ve "no se pudo entregar el recordatorio de FV-123" en su bandeja y decide: si el
      // pagador es un cliente real, lo carga como titular y el próximo barrido sale solo.
      if (e instanceof DestinoNoRegistrado) return fail(e.message, false);
      throw e;
    }
  }
}

/**
 * Fábrica del puerto de mensajería del despachador. Real por defecto; simulado
 * si CARTERA_MESSAGING_SIMULATED='1' (E2E/local sin credenciales reales).
 */
export function getMessagingPort(clinicId: string): MessagingPort {
  if (process.env.CARTERA_MESSAGING_SIMULATED === '1') return new SimulatedMessaging();
  return new RealMessaging(clinicId);
}
