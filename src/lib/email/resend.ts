import "server-only"

// Transporte de Resend — REST directo, sin SDK. Mismo criterio que el resto del repo
// (google-calendar.ts, microsoft-calendar.ts): una llamada `fetch` a una API estable no justifica
// una dependencia más que mantener y auditar.
//
// Resend es el camino de los correos TRANSACCIONALES de Tuvetia (facturas, recordatorios,
// notificaciones). No reemplaza al SMTP por cuenta: ese sigue siendo el de la bandeja personal de
// cada miembro. La diferencia está explicada en CORREOS.md.

import { pareceHtml } from "./html-a-texto"
import { textoDelCorreo } from "./maqueta"

const API = "https://api.resend.com/emails"

export interface ResendInput {
  /** "Nombre <correo@dominio>" o solo el correo. */
  from: string
  to: string | string[]
  subject: string
  /**
   * El correo, en HTML. **Obligatorio.** Se arma con `maquetarCorreo` (maqueta.ts).
   *
   * ── POR QUÉ ES OBLIGATORIO Y NO "acordarse de pasarlo" ──────────────────────────────────────
   *
   * Hasta hoy esto era al revés: `text` obligatorio, `html` opcional. Y el resultado medido fue que
   * NINGÚN sitio de envío pasaba `html`: la invitación al equipo, la factura, la cobranza, el aviso
   * a titulares y el masivo de plataforma salían todos en texto plano. No por decisión de nadie —
   * simplemente porque el camino corto era el que dejaba el tipo.
   *
   * Dado vuelta, un correo en texto plano deja de ser POSIBLE en vez de depender de que nadie se
   * olvide. Es la diferencia entre una convención y una garantía: la convención se sostiene mientras
   * alguien la recuerde en cada archivo nuevo, la garantía la revisa el compilador. Ésa es la
   * decisión de fondo de todo este cambio.
   */
  html: string
  /**
   * La alternativa `text/plain` del MISMO mensaje. Si no viene, se deriva del `html`.
   *
   * NO ES UN RESTO QUE QUEDÓ: sigue viajando en cada correo. Es lo que exige un mensaje bien formado
   * (multipart/alternative), lo que leen los lectores de pantalla y los clientes en modo texto, y lo
   * que mira un filtro de spam cuando decide si un correo sólo-HTML es sospechoso. Lo que cambió es
   * que se DERIVA en vez de escribirse a mano, así no puede quedar diciendo algo distinto del HTML.
   *
   * Se pasa a mano sólo cuando la derivación no sirve para ese correo puntual.
   */
  text?: string | null
  /** A dónde responde el destinatario. Acá va el correo de la clínica, no el de Tuvetia. */
  replyTo?: string | string[] | null
  /** Message-ID propio, para poder reconocer después las respuestas a este correo. */
  headers?: Record<string, string>
}

export interface ResendResult {
  ok: boolean
  id: string | null
  error?: string
  /**
   * true si el fallo es TRANSITORIO (red, 429, 5xx) y no estructural (dominio sin verificar,
   * destinatario inválido, API key mala). El motor de cartera reprograma los transitorios en vez
   * de marcar el recordatorio como OMITIDO y perderlo — misma semántica que el puerto SMTP.
   */
  transient?: boolean
}

const TIMEOUT_MS = 15_000

export function resendApiKey(): string | null {
  return process.env.RESEND_API_KEY?.trim() || null
}

/**
 * Envía por Resend.
 *
 * Devuelve un resultado en vez de lanzar, igual que `sendEmail` de smtp.ts: los callers son el
 * motor de cobranza y el envío de facturas, que necesitan distinguir un fallo reprogramable de uno
 * definitivo.
 */
export async function sendViaResend(input: ResendInput): Promise<ResendResult> {
  const key = resendApiKey()
  if (!key) {
    return {
      ok: false,
      id: null,
      error: "Falta RESEND_API_KEY en el servidor: los correos de Tuvetia no pueden salir.",
      transient: false,
    }
  }

  // El tipo ya obliga a que haya `html`, pero nada obliga a que sea HTML: un `html: "Hola,\n\n…"`
  // compila igual y llega sin maquetar. No se corrige en silencio —adivinar qué quiso mandar el que
  // llama es peor— pero queda dicho en el log, que es donde se mira cuando un correo llega feo.
  if (!pareceHtml(input.html)) {
    console.warn("[email/resend] el `html` no parece HTML: ¿se armó con `maquetarCorreo`?")
  }

  // La alternativa en texto se deriva del HTML: un solo original, dos formas de leerlo. Escribirla
  // aparte es lo que produce el correo cuyo texto plano dice una cosa y cuyo HTML dice otra.
  const texto = input.text?.trim() || textoDelCorreo(input.html)

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: input.from,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        text: texto,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!res.ok) {
      const cuerpo = (await res.json().catch(() => ({}))) as { message?: string; name?: string }
      const detalle = cuerpo.message || cuerpo.name || `HTTP ${res.status}`
      // 429 y 5xx se reintentan; el resto es configuración (dominio sin verificar, clave revocada,
      // destinatario inválido) y reintentar no lo arregla.
      const transient = res.status === 429 || res.status >= 500
      console.error(`[email/resend] envío rechazado (${res.status}):`, detalle)
      return { ok: false, id: null, error: explicar(res.status, detalle), transient }
    }

    const json = (await res.json()) as { id?: string }
    return { ok: true, id: json.id ?? null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de red"
    console.error("[email/resend] fallo de red:", msg)
    // Timeout o red caída: reprogramable.
    return { ok: false, id: null, error: `No se pudo contactar a Resend: ${msg}`, transient: true }
  }
}

/** Traduce los rechazos típicos de Resend a algo accionable, no a un número. */
function explicar(status: number, detalle: string): string {
  if (status === 401 || status === 403) {
    return "Resend rechazó la credencial (RESEND_API_KEY). Verificá que sea válida y esté vigente."
  }
  if (/domain is not verified|not verified/i.test(detalle)) {
    return "El dominio del remitente no está verificado en Resend. Hay que agregar los registros SPF y DKIM del dominio antes de poder enviar."
  }
  if (status === 422) return `Resend rechazó el correo: ${detalle}`
  return `Resend devolvió un error: ${detalle}`
}
