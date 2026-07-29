// Puerto de mensajería de cartera. El motor (scheduler/outbox) SOLO conoce esta
// interfaz; el adaptador real (WhatsApp vía sendWhatsAppText; email = stub sin
// configurar) vive en ./channels. En tests/E2E se usa el proveedor SIMULADO:
// registra el envío y lo da por entregado, para ejercitar programación, gate
// Ley 2300, idempotencia y detención sin depender de integraciones reales.
//
// Nota del port: se eliminaron los campos de plantillas Meta (waTemplate) y de
// hilos Gmail — el destino redacta el texto del recordatorio directamente y no
// tiene Gmail (contrato §5).

import type { CommsChannel } from '@/lib/supabase/types';

export interface OutboundMessage {
  channel: CommsChannel;
  to: string;
  /** step_kind en minúsculas — idempotencia/logging. */
  template: string;
  /** Texto ya redactado (cuerpo del WhatsApp / futuro email). */
  body: string;
  /** Contexto para los adaptadores reales (vínculos, registro del saliente). */
  invoiceId?: string | null;
  ownerId?: string | null;
  /** Asunto del correo (reservado para cuando exista email). */
  subject?: string | null;
}

export interface SendResult {
  ok: boolean;
  provider: string;
  providerMessageId: string | null;
  /** Estado inicial reportado por el proveedor. */
  status: 'ENVIADO' | 'ENTREGADO' | 'FALLIDO';
  error?: string;
  /**
   * true si el canal no está disponible por una causa TRANSITORIA (integración
   * caída, número desconectado) y no estructural: el despachador debe
   * reprogramar sin perder el recordatorio, no marcarlo OMITIDO.
   */
  transient?: boolean;
}

export interface MessagingPort {
  readonly name: string;
  /** ¿Qué canales tiene conectados y operativos esta clínica? */
  connectedChannels(): Promise<CommsChannel[]>;
  send(msg: OutboundMessage): Promise<SendResult>;
}

/**
 * Proveedor simulado. Determinista: entrega siempre, salvo destino vacío.
 * Ambos canales se consideran "conectados" para poder probar la selección.
 */
export class SimulatedMessaging implements MessagingPort {
  readonly name = 'SIMULADO';
  private counter = 0;

  async connectedChannels(): Promise<CommsChannel[]> {
    return ['WHATSAPP', 'EMAIL'];
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!msg.to?.trim()) {
      return { ok: false, provider: this.name, providerMessageId: null, status: 'FALLIDO', error: 'Destino vacío' };
    }
    this.counter += 1;
    return {
      ok: true,
      provider: this.name,
      providerMessageId: `sim_${this.counter}`,
      status: 'ENTREGADO',
    };
  }
}
