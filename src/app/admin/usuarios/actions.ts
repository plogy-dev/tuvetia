"use server"

// El `maxDuration` que este envío masivo necesita NO puede vivir acá: un archivo `"use server"`
// sólo admite exports de funciones async, y `export const maxDuration` rompe el build. Va en
// `usuarios/page.tsx`, que es el segmento de ruta desde el que se invocan estas acciones.

// Acciones del panel de plataforma. Cada una re-verifica el gate: una server action es un ENDPOINT
// propio, invocable con un POST, y el `notFound()` del layout no la protege — el layout sólo corre
// al renderizar la página.

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isPlatformAdmin } from "@/lib/platform-admin"
import { sendPlatformEmail } from "@/lib/email/platform-sender"
import { TOPE_ENVIO_MASIVO } from "@/lib/admin/limites"
import { huecos } from "@/lib/email/plantillas"

const EnvioSchema = z.object({
  to: z.string().email("El correo del destinatario no es válido"),
  subject: z.string().trim().min(1, "El asunto no puede ir vacío").max(200),
  text: z.string().trim().min(1, "El mensaje no puede ir vacío").max(20_000),
})

export type ResultadoEnvio = { ok: true; mensaje: string } | { ok: false; error: string }

// ── Desactivar / reactivar una cuenta ─────────────────────────────────────────────────────────
//
// LA MITAD QUE FALTABA. El gate de cuenta desactivada existe desde la migración 0059 y el bypass se
// cerró en la 0060, pero `profiles.is_active` se LEÍA en dos lugares y no se ESCRIBÍA en ninguno:
// no había forma de desactivar a nadie desde el producto, sólo por SQL a mano. El panel ya pintaba
// la insignia "inactivo" (`usuarios/page.tsx`), así que la pantalla estaba y faltaba la escritura.
//
// POR QUÉ FUNCIONA CON `service_role`. El trigger `profiles_guard_sensitive_columns` bloquea que la
// SESIÓN DEL USUARIO toque `is_active` —ése era el bypass— pero deja pasar a `postgres` y a
// `service_role`. La 0060 lo dejó así a propósito, anticipando exactamente esta ruta.

const ActivacionSchema = z.object({
  userId: z.string().uuid("El identificador de usuario no es válido"),
  activo: z.boolean(),
  // Queda en la traza, no en la pantalla del vet. Para una desactivación por abuso, "por qué" es
  // la mitad del valor del registro.
  motivo: z.string().trim().max(500).optional(),
})

export async function cambiarActivacion(input: {
  userId: string
  activo: boolean
  motivo?: string
}): Promise<ResultadoEnvio> {
  const admin = await adminActual()
  if (!admin) return { ok: false, error: "No autorizado." }

  const parsed = ActivacionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." }
  }
  const { userId, activo, motivo } = parsed.data

  // NADIE SE DESACTIVA A SÍ MISMO. No es una hipótesis rebuscada: el botón vive en una tabla donde
  // el admin también aparece como usuario, en su propia fila, al lado de todos los demás. Un clic
  // en la fila equivocada lo deja sin `/dashboard` y sin nada que apretar para volver.
  if (!activo && userId === admin.id) {
    return { ok: false, error: "No podés desactivar tu propia cuenta." }
  }

  const supabaseAdmin = createAdminClient()

  // Se lee ANTES de escribir para poder registrar el estado previo y para no anotar en la traza un
  // cambio que no ocurrió (desactivar a quien ya estaba desactivado).
  const { data: antes, error: errLectura } = await supabaseAdmin
    .from("profiles")
    .select("is_active, full_name")
    .eq("id", userId)
    .maybeSingle()

  if (errLectura) return { ok: false, error: `No se pudo leer el perfil: ${errLectura.message}` }
  if (!antes) return { ok: false, error: "Ese usuario no existe." }

  const previo = (antes as { is_active: boolean | null }).is_active
  const nombre = (antes as { full_name: string | null }).full_name ?? "la cuenta"
  if (previo === activo) {
    return { ok: true, mensaje: `${nombre} ya estaba ${activo ? "activa" : "desactivada"}.` }
  }

  const { error } = await supabaseAdmin.from("profiles").update({ is_active: activo }).eq("id", userId)
  if (error) {
    return { ok: false, error: `No se pudo ${activo ? "reactivar" : "desactivar"}: ${error.message}` }
  }

  // La traza va DESPUÉS del cambio y no lo revierte si falla: una desactivación aplicada y sin
  // registrar es mejor que una que se deshace porque el log no respondió. Queda ruidosa en consola.
  const { error: errTraza } = await supabaseAdmin.from("audit_logs").insert({
    clinic_id: null,
    user_id: admin.id,
    action: activo ? "platform_user.reactivated" : "platform_user.deactivated",
    table_name: "profiles",
    record_id: userId,
    payload: { de: previo, a: activo, motivo: motivo ?? null, by: admin.email },
  })
  if (errTraza) {
    console.error("[admin/usuarios] no se pudo registrar el cambio de activación:", errTraza.message)
  }

  // Sin esto la tabla sigue mostrando el estado viejo hasta que alguien recargue a mano.
  revalidatePath("/admin/usuarios")

  return {
    ok: true,
    mensaje: activo
      ? `${nombre} puede volver a entrar.`
      : `${nombre} quedó sin acceso. Sus datos NO se borraron.`,
  }
}

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
//   · un envío que puede tardar hasta 20 s antes de rendirse,
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

const MasivoSchema = z
  .object({
    destinatarios: z
      .array(z.string().email())
      .min(1, "Elegí al menos un destinatario")
      .max(TOPE_MASIVO, `Máximo ${TOPE_MASIVO} destinatarios por tanda`),
    subject: z.string().trim().min(1, "El asunto no puede ir vacío").max(200),
    text: z.string().trim().min(1, "El mensaje no puede ir vacío").max(20_000),
  })
  // EL HUECO SIN RELLENAR, CORTADO EN EL SERVIDOR. El panel ya deshabilita el botón cuando quedan
  // marcas, pero una server action es un ENDPOINT: se la puede llamar sin pasar por la interfaz, y
  // el día que alguien arme un script para la tanda del mes, la validación de la pantalla no
  // existe. "Hola {{nombre}}," a doce clínicas no se puede deshacer.
  //
  // Se usa la MISMA función que arma la vista previa (`lib/email/plantillas`): dos criterios
  // distintos darían un texto que la pantalla deja mandar y el servidor rebota — o al revés, que es
  // peor.
  .superRefine((v, ctx) => {
    const sinLlenar = huecos(v.subject, v.text)
    if (sinLlenar.length === 0) return
    ctx.addIssue({
      code: "custom",
      // Se nombran los huecos: "faltan datos" a secas obliga a releer 20 líneas para encontrar cuál.
      message: `Faltan datos en la plantilla: ${sinLlenar.map((h) => `{{${h}}}`).join(", ")}`,
    })
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
