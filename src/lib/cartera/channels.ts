import 'server-only';

// Adaptador de mensajerÃ­a REAL de cartera. Reemplaza a SimulatedMessaging
// detrÃ¡s del puerto MessagingPort SIN tocar el scheduler.
//
// AdaptaciÃ³n del port (contrato Â§5):
//   Â· WhatsApp â†’ sendWhatsAppText de @/lib/whatsapp/send-message (el ÃšNICO
//     camino de salida del destino; el transporte ya aplica cadencia humana).
//     SIN plantillas Meta: el texto del recordatorio llega ya redactado en
//     msg.body. El saliente queda registrado en whatsapp_messages por el
//     propio sendWhatsAppText (agent_mode 'auto', sent_by null = sistema).
//   Â· Email â†’ sendEmail de @/lib/email/smtp con las credenciales cifradas de la
//     clÃ­nica. connectedChannels lo reporta sÃ³lo si la integraciÃ³n estÃ¡ en
//     'connected'; si no, el scheduler salta el canal con log, como antes.
//
// Nunca decide A QUIÃ‰N ni CUÃNDO contactar (eso es del gate Ley 2300 en el
// dominio): solo materializa el envÃ­o que el despachador ya autorizÃ³.

import { loadEmailCredentials } from '@/lib/email/integrations';
import { sendEmail } from '@/lib/email/smtp';
import { buildMessageId } from '@/lib/email/threading';
import { loadIntegration, sendWhatsAppText } from '@/lib/whatsapp/send-message';
import type { CommsChannel } from '@/lib/supabase/types';
import { SimulatedMessaging, type MessagingPort, type OutboundMessage, type SendResult } from './messaging';

function fail(error: string, transient = false): SendResult {
  return { ok: false, provider: 'REAL', providerMessageId: null, status: 'FALLIDO', error, transient };
}

export class RealMessaging implements MessagingPort {
  readonly name = 'REAL';
  constructor(private readonly clinicId: string) {}

  async connectedChannels(): Promise<CommsChannel[]> {
    const channels: CommsChannel[] = [];

    const [integ, correo] = await Promise.all([
      loadIntegration(this.clinicId),
      loadEmailCredentials(this.clinicId),
    ]);
    if (integ && integ.status === 'connected') channels.push('WHATSAPP');
    // El correo se reporta conectado sÃ³lo si la clÃ­nica lo conectÃ³ de verdad. Si no, se salta con
    // log â€” igual que antes, pero ahora por ausencia de configuraciÃ³n y no por diseÃ±o.
    if (correo) channels.push('EMAIL');
    else
      console.log(
        `[cartera/channels] clinic=${this.clinicId} canal EMAIL omitido: sin integraciÃ³n de correo`,
      );
    return channels;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!msg.to?.trim()) return fail('Destino vacÃ­o');
    try {
      if (msg.channel === 'EMAIL') return await this.sendEmail(msg);
      return await this.sendWhatsApp(msg);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error de envÃ­o';
      // "WhatsApp no estÃ¡ conectado" â†’ transitorio (no perder el recordatorio:
      // el despachador reprograma en vez de omitir).
      const transient = /no estÃ¡ conectado|no esta conectado/i.test(message);
      return fail(message, transient);
    }
  }

  /**
   * Recordatorio de cobranza por correo.
   *
   * Se apoya en el mismo transporte que ya usa la facturaciÃ³n (`@/lib/email/smtp`), que devuelve
   * `transient` distinguiendo un fallo de red o un lÃ­mite del proveedor â€”reprogramableâ€” de una
   * credencial rechazada. El despachador usa esa distinciÃ³n para no perder el recordatorio.
   *
   * El asunto y el cuerpo llegan ya redactados en `msg`: este adaptador NO decide quÃ© decir, ni a
   * quiÃ©n, ni cuÃ¡ndo â€” eso es del gate de la Ley 2300 en el dominio.
   */
  private async sendEmail(msg: OutboundMessage): Promise<SendResult> {
    const creds = await loadEmailCredentials(this.clinicId);
    if (!creds) return fail('sin integraciÃ³n de correo en esta clÃ­nica');

    // Message-ID propio: es la raÃ­z del hilo y lo que permite reconocer la respuesta del titular
    // cuando entra por IMAP. Sin Ã©l, la respuesta llegarÃ­a como un correo suelto sin conversaciÃ³n.
    const messageId = buildMessageId(msg.invoiceId ?? this.clinicId, creds.from_email, `${Date.now()}`);
    const r = await sendEmail(creds, {
      to: msg.to,
      subject: msg.subject?.trim() || 'Recordatorio de pago',
      text: msg.body,
      messageId,
    });
    if (!r.ok) return fail(r.error ?? 'Error de envÃ­o de correo', r.transient ?? false);
    return { ok: true, provider: 'email', providerMessageId: r.messageId, status: 'ENVIADO' };
  }

  private async sendWhatsApp(msg: OutboundMessage): Promise<SendResult> {
    const { waMessageId } = await sendWhatsAppText(this.clinicId, msg.to, msg.body, {
      ownerId: msg.ownerId ?? null,
      sentBy: null, // lo enviÃ³ el motor de cartera, no un humano
      agentMode: 'auto',
    });
    return { ok: true, provider: 'whatsapp', providerMessageId: waMessageId, status: 'ENVIADO' };
  }
}

/**
 * FÃ¡brica del puerto de mensajerÃ­a del despachador. Real por defecto; simulado
 * si CARTERA_MESSAGING_SIMULATED='1' (E2E/local sin credenciales reales).
 */
export function getMessagingPort(clinicId: string): MessagingPort {
  if (process.env.CARTERA_MESSAGING_SIMULATED === '1') return new SimulatedMessaging();
  return new RealMessaging(clinicId);
}
