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
//   · Email → NO configurado en el destino: connectedChannels no lo reporta y
//     send() devuelve FALLIDO con error 'email_no_configurado'. El scheduler
//     salta el canal con log. Nada de nodemailer/Gmail.
//
// Nunca decide A QUIÉN ni CUÁNDO contactar (eso es del gate Ley 2300 en el
// dominio): solo materializa el envío que el despachador ya autorizó.

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

    const integ = await loadIntegration(this.clinicId);
    if (integ && integ.status === 'connected') channels.push('WHATSAPP');

    // EMAIL nunca figura conectado: el destino no tiene email configurado.
    // (contrato §5: el scheduler salta el canal con log)
    console.log(
      `[cartera/channels] clinic=${this.clinicId} canal EMAIL omitido: email_no_configurado`,
    );
    return channels;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!msg.to?.trim()) return fail('Destino vacío');
    if (msg.channel === 'EMAIL') return fail('email_no_configurado');
    try {
      return await this.sendWhatsApp(msg);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error de envío';
      // "WhatsApp no está conectado" → transitorio (no perder el recordatorio:
      // el despachador reprograma en vez de omitir).
      const transient = /no está conectado|no esta conectado/i.test(message);
      return fail(message, transient);
    }
  }

  private async sendWhatsApp(msg: OutboundMessage): Promise<SendResult> {
    const { waMessageId } = await sendWhatsAppText(this.clinicId, msg.to, msg.body, {
      ownerId: msg.ownerId ?? null,
      sentBy: null, // lo envió el motor de cartera, no un humano
      agentMode: 'auto',
    });
    return { ok: true, provider: 'whatsapp', providerMessageId: waMessageId, status: 'ENVIADO' };
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
