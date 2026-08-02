import { beforeEach, describe, expect, it, vi } from 'vitest';

// Canal de correo del motor de cartera. Se prueba el ADAPTADOR, no el transporte: que traduzca
// bien entre el puerto de mensajería y el envío transaccional, y sobre todo que **no pierda un
// recordatorio en silencio**, que es el único fallo caro de este archivo.
//
// El canal estuvo devolviendo `email_no_configurado` incluso después de que el módulo de correo
// funcionara — las facturas salían y las respuestas entraban, pero la cobranza seguía siendo sólo
// WhatsApp. Estas pruebas fijan el comportamiento para que no vuelva a quedar desconectado.
//
// Desde que el correo de cobranza es TRANSACCIONAL (sale del remitente de Tuvetia, ver CORREOS.md),
// el canal ya no depende del SMTP de cada clínica: depende de que Tuvetia tenga su remitente
// configurado. `remitenteConfigurado` simula eso.

let remitenteConfigurado = true;
let resultadoEnvio: { ok: boolean; id: string | null; error?: string; transient?: boolean } = {
  ok: true,
  id: '<enviado@tuvetia>',
};
const enviados: unknown[] = [];

vi.mock('@/lib/email/resend', () => ({
  resendApiKey: () => (remitenteConfigurado ? 're_test' : null),
}));

vi.mock('@/lib/email/transactional', () => ({
  transactionalFrom: () => 'vet@tuvetia.com',
  sendTransactionalEmail: async (_clinicId: string, input: unknown) => {
    enviados.push(input);
    return resultadoEnvio;
  },
}));

vi.mock('@/lib/whatsapp/send-message', () => ({
  loadIntegration: async () => null,
  sendWhatsAppText: async () => ({ waMessageId: 'wa-1' }),
}));

const { RealMessaging } = await import('../channels');

const MSG = {
  channel: 'EMAIL' as const,
  to: 'titular@ejemplo.com',
  template: 'recordatorio',
  body: 'Tenés una factura pendiente.',
  subject: 'Recordatorio de pago',
  invoiceId: 'fac-123',
  ownerId: 'own-1',
};

beforeEach(() => {
  remitenteConfigurado = true;
  resultadoEnvio = { ok: true, id: '<enviado@tuvetia>' };
  enviados.length = 0;
});

describe('canal de correo de cartera', () => {
  it('envía y devuelve ENVIADO con el id del proveedor', async () => {
    const r = await new RealMessaging('clinic-a').send(MSG);
    expect(r.ok).toBe(true);
    expect(r.status).toBe('ENVIADO');
    expect(r.provider).toBe('email');
    expect(r.providerMessageId).toBe('<enviado@tuvetia>');
    expect(enviados).toHaveLength(1);
  });

  it('manda un Message-ID propio: es la raíz del hilo', async () => {
    // Sin él, la respuesta del titular entraría por IMAP como un correo suelto, sin conversación a
    // la que pegarse — y la cobranza por correo dejaría de cerrar el ciclo.
    await new RealMessaging('clinic-a').send(MSG);
    const enviado = enviados[0] as { messageId: string; to: string; subject: string };
    expect(enviado.messageId).toBeTruthy();
    expect(enviado.messageId).toContain('fac-123');
    expect(enviado.to).toBe('titular@ejemplo.com');
    expect(enviado.subject).toBe('Recordatorio de pago');
  });

  it('usa un asunto por defecto si viene vacío', async () => {
    await new RealMessaging('clinic-a').send({ ...MSG, subject: null });
    expect((enviados[0] as { subject: string }).subject).toBe('Recordatorio de pago');
  });

  it('sin remitente de Tuvetia falla con mensaje claro, no lanza', async () => {
    // Ya no es "la clínica no configuró su correo": el remitente es de la plataforma, así que si
    // falta, falta para todos y es un problema de despliegue, no del vet.
    resultadoEnvio = {
      ok: false,
      id: null,
      error: 'Falta RESEND_API_KEY en el servidor: los correos de Tuvetia no pueden salir.',
      transient: false,
    };
    const r = await new RealMessaging('clinic-a').send(MSG);
    expect(r.ok).toBe(false);
    expect(r.status).toBe('FALLIDO');
    expect(r.error).toContain('RESEND_API_KEY');
    expect(r.transient).toBe(false); // estructural: reintentar no arregla nada
  });

  it('PROPAGA transient: un fallo de red reprograma en vez de perder el recordatorio', async () => {
    // Es la razón de ser de este flag. Si se perdiera, un corte de red momentáneo marcaría el
    // recordatorio como omitido y el titular nunca recibiría el aviso.
    resultadoEnvio = { ok: false, id: null, error: 'ETIMEDOUT', transient: true };
    const r = await new RealMessaging('clinic-a').send(MSG);
    expect(r.ok).toBe(false);
    expect(r.transient).toBe(true);
    expect(r.error).toContain('ETIMEDOUT');
  });

  it('una credencial rechazada NO es transitoria', async () => {
    resultadoEnvio = { ok: false, id: null, error: 'dominio no verificado', transient: false };
    const r = await new RealMessaging('clinic-a').send(MSG);
    expect(r.transient).toBe(false);
  });

  it('un destino vacío se rechaza antes de tocar el transporte', async () => {
    const r = await new RealMessaging('clinic-a').send({ ...MSG, to: '  ' });
    expect(r.ok).toBe(false);
    expect(enviados).toHaveLength(0);
  });

  it('connectedChannels reporta EMAIL para CUALQUIER clínica si Tuvetia tiene remitente', async () => {
    // El cambio de fondo: la cobranza por correo ya no exige que cada clínica configure SMTP, que
    // era el motivo por el que en la práctica terminaba siendo sólo WhatsApp.
    expect(await new RealMessaging('clinic-a').connectedChannels()).toContain('EMAIL');
    remitenteConfigurado = false;
    expect(await new RealMessaging('clinic-a').connectedChannels()).not.toContain('EMAIL');
  });
});
