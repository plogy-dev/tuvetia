"use server"

// El `maxDuration` que este envío masivo necesita NO puede vivir acá: un archivo `"use server"`
// sólo admite exports de funciones async, y `export const maxDuration` rompe el build. Va en
// `usuarios/page.tsx`, que es el segmento de ruta desde el que se invocan estas acciones.

// Acciones del panel de plataforma. Cada una re-verifica el gate: una server action es un ENDPOINT
// propio, invocable con un POST, y el `notFound()` del layout no la protege — el layout sólo corre
// al renderizar la página.

import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isPlatformAdmin } from "@/lib/platform-admin"
import { sendPlatformEmail } from "@/lib/email/platform-sender"
import { TOPE_ENVIO_MASIVO } from "@/lib/admin/limites"

const EnvioSchema = z.object({
  to: z.string().email("El correo del destinatario no es válido"),
  subject: z.string().trim().min(1, "El asunto no puede ir vacío").max(200),
  text: z.string().trim().min(1, "El mensaje no puede ir vacío").max(20_000),
})

export type ResultadoEnvio = { ok: true; mensaje: string } | { ok: false; error: string }

/** Quién está pidiendo la acción, o `null` si no es admin de plataforma. */
async function adminActual(): Promise<{ id: string; email: string } | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email || !isPlatformAdmin(user.email)) return null
  return { id: user.id, email: user.email }
}

/**
 * Envío INDIVIDUAL desde la fila del usuario.
 *
 * El masivo no es "esto mismo en un bucle" y por eso no está acá: exige consentimiento (Ley 1581 si
 * el contenido es comercial y no operativo), manejo de rebotes, enlace de baja, ritmo entre envíos
 * y traza por destinatario. Sin eso, un solo envío grande quema la reputación del dominio.
 */
export async function enviarCorreoPlataforma(input: {
  to: string
  subject: string
  text: string
}): Promise<ResultadoEnvio> {
  const admin = await adminActual()
  if (!admin) return { ok: false, error: "No autorizado." }

  const parsed = EnvioSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." }
  }
  const { to, subject, text } = parsed.data

  const res = await sendPlatformEmail({ to, subject, text })

  // Traza: a quién, qué y cuándo. `audit_logs.clinic_id` es nullable, que es justo lo que hace
  // falta para un envío de plataforma (no pertenece a ninguna clínica).
  await createAdminClient()
    .from("audit_logs")
    .insert({
      clinic_id: null,
      user_id: admin.id,
      action: "platform_email.sent",
      table_name: null,
      record_id: null,
      payload: {
        to,
        subject,
        ok: res.ok,
        error: res.error ?? null,
        transient: res.transient ?? null,
        by: admin.email,
      },
    })
    .then(({ error }) => {
      if (error) console.error("[admin/usuarios] no se pudo registrar el envío:", error.message)
    })

  if (!res.ok) {
    return {
      ok: false,
      error: res.transient
        ? `Fallo temporal enviando a ${to}: ${res.error}. Reintentá en un momento.`
        : `No se pudo enviar a ${to}: ${res.error}`,
    }
  }
  return { ok: true, mensaje: `Correo enviado a ${to}.` }
}

// ── Envío MASIVO ──────────────────────────────────────────────────────────────────────────────
//
// Alcance deliberadamente acotado a AVISOS OPERATIVOS a usuarios existentes del producto
// (mantenimiento, cambios, incidencias). NO sirve para contenido comercial: eso exige base legal
// bajo la Ley 1581, enlace de baja y registro de consentimiento, y nada de eso está construido.
// La UI lo dice y esta función no puede verificarlo — es una decisión de quien redacta.
//
// Tres guardarraíles que sí están:
//   · TOPE duro de destinatarios. Por encima hace falta una cola de verdad: esto corre dentro de
//     una función serverless y un lote grande se corta por tiempo a mitad, sin saber por dónde iba.
//   · RITMO entre envíos. Un SMTP al que le caen 50 conexiones seguidas responde con rate limit y
//     empieza a rebotar — y los rebotes son lo que quema la reputación del dominio.
//   · REINTENTO sólo de lo transitorio. `sendEmail` ya distingue un 535 (credencial mala, no se
//     reintenta) de un timeout de red (sí). Reintentar una credencial mala 50 veces no la arregla.
// EL TOPE LO MANDA EL RELOJ DE LA FUNCIÓN, no el gusto. Este bucle corre dentro de una server
// action, o sea una función serverless con límite de tiempo, y hace tres cosas que suman:
//
//   · una pausa de MS_ENTRE_ENVIOS entre destinatarios,
//   · un envío SMTP que `email/smtp.ts` deja llegar hasta 20 s antes de rendirse,
//   · y un reintento con pausa doble cuando el fallo es transitorio.
//
// Con el tope anterior de 50 el peor caso pasaba de dos minutos y el mejor rondaba el minuto: la
// función se cortaba a mitad del lote y el operador veía un error sin saber a quién le había
// llegado. (Se podía reconstruir desde `audit_logs`, pero eso es forense, no una respuesta.)
//
// 12 × (1,2 s + ~2 s de SMTP) ≈ 40 s, con `maxDuration = 120` de colchón para los reintentos. Para
// tandas más grandes hace falta una cola de verdad, no un tope más alto.
//
// El número vive en `lib/admin/limites.ts` para que la UI ofrezca exactamente el mismo que el
// servidor valida.
const TOPE_MASIVO = TOPE_ENVIO_MASIVO
const MS_ENTRE_ENVIOS = 1200

const MasivoSchema = z.object({
  destinatarios: z
    .array(z.string().email())
    .min(1, "Elegí al menos un destinatario")
    .max(TOPE_MASIVO, `Máximo ${TOPE_MASIVO} destinatarios por tanda`),
  subject: z.string().trim().min(1, "El asunto no puede ir vacío").max(200),
  text: z.string().trim().min(1, "El mensaje no puede ir vacío").max(20_000),
})

export type ResultadoMasivo =
  | { ok: true; enviados: number; fallidos: { email: string; error: string }[] }
  | { ok: false; error: string }

export async function enviarCorreoMasivo(input: {
  destinatarios: string[]
  subject: string
  text: string
}): Promise<ResultadoMasivo> {
  const admin = await adminActual()
  if (!admin) return { ok: false, error: "No autorizado." }

  const parsed = MasivoSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." }
  }
  // Deduplicar: una lista con el mismo correo dos veces le manda el aviso dos veces.
  const destinatarios = [...new Set(parsed.data.destinatarios.map((e) => e.trim().toLowerCase()))]
  const { subject, text } = parsed.data

  const supabaseAdmin = createAdminClient()
  const fallidos: { email: string; error: string }[] = []
  let enviados = 0

  for (const [i, to] of destinatarios.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, MS_ENTRE_ENVIOS))

    let res = await sendPlatformEmail({ to, subject, text })
    if (!res.ok && res.transient) {
      await new Promise((r) => setTimeout(r, MS_ENTRE_ENVIOS * 2))
      res = await sendPlatformEmail({ to, subject, text })
    }

    if (res.ok) enviados++
    else fallidos.push({ email: to, error: res.error ?? "desconocido" })

    // Traza POR DESTINATARIO, no una sola del lote: si algo rebota hay que poder decir a quién le
    // llegó y a quién no.
    const { error } = await supabaseAdmin.from("audit_logs").insert({
      clinic_id: null,
      user_id: admin.id,
      action: "platform_email.bulk_sent",
      payload: { to, subject, ok: res.ok, error: res.error ?? null, by: admin.email },
    })
    if (error) console.error("[admin/usuarios] no se pudo registrar el envío masivo:", error.message)
  }

  return { ok: true, enviados, fallidos }
}
