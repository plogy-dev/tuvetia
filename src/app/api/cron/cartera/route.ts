import { runCarteraForAllClinics } from "@/lib/cartera/run-all"
import { syncEmailRepliesForAllClinics } from "@/lib/email/sync"
import { syncInboxForAllUsers } from "@/lib/email/inbox"

// Barrido de cartera: recorre las clínicas con recordatorios activos, programa los pasos que
// falten y despacha los vencidos. El motor ya existía y estaba cubierto por tests, pero no tenía
// quién lo llamara — o sea que los recordatorios nunca salían solos.
//
// Frecuencia: DIARIO a las 14:00 UTC = 9:00 en Colombia (ver vercel.json). Las 9:00 no son
// arbitrarias: es la hora a la que el motor programa los recordatorios (SEND_HOUR en
// domain/reminders.ts), así que un solo barrido a esa hora los agarra a todos en su momento.
// El plan Hobby de Vercel permite 2 crons con disparo diario — justo los que tenemos — y dispara
// dentro de la hora indicada; 9:00–10:00 Colombia cae holgado dentro de la ventana legal (7–19).
//
// Un recordatorio DENEGADO por el gate (p. ej. "ya se contactó hoy") se reprograma y sale en el
// barrido siguiente. Si algún día el volumen pide más frecuencia, la salida sin costo es un
// workflow de GitHub Actions pegándole a este mismo endpoint — no cambia nada de este código.
//
// El cron NO decide si se puede contactar: eso lo resuelve el gate de la Ley 2300 dentro del motor
// (ventana horaria, un contacto por día, festivos, canal autorizado). Correr de más es inofensivo:
// el barrido es idempotente y lo que no toca se reprograma.
//
// Protegido con CRON_SECRET: Vercel manda Authorization: Bearer <CRON_SECRET>.

export const maxDuration = 300 // el barrido recorre todas las clínicas en serie

export async function GET(req: Request) {
  // Estricto a propósito: si falta el secreto, 503 y no se corre nada. La variante permisiva
  // (`if (secret && ...)`) deja el endpoint ABIERTO cuando la env no está definida, que es
  // justo cuando menos te enterás. Este barrido manda mensajes reales a titulares.
  const secret = process.env.CRON_SECRET
  if (!secret) return new Response("Cron no configurado (falta CRON_SECRET)", { status: 503 })
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  try {
    const result = await runCarteraForAllClinics()

    // Lectura de respuestas por correo, EN EL MISMO CRON a propósito: el plan Hobby de Vercel
    // permite 2 crons y los 2 cupos están usados (este y purge-audio). El correo no tiene webhook
    // (a diferencia de WhatsApp), así que este barrido es su única vía de entrada. Si falla, no
    // tumba el resultado de cartera: se reporta aparte.
    let email: Awaited<ReturnType<typeof syncEmailRepliesForAllClinics>> | { error: string }
    try {
      email = await syncEmailRepliesForAllClinics()
    } catch (e) {
      email = { error: e instanceof Error ? e.message : "barrido de correo fallido" }
      console.error("cron/cartera email-sync:", email.error)
    }

    // Bandeja de correo (migración 0050): guarda el buzón entero para la sección Comunicaciones y
    // para que Athos pueda leerlo. Va acá por el mismo motivo que el de arriba —no hay cupo para un
    // cron propio— y es una pasada IMAP SEPARADA a propósito: el barrido de cartera despacha
    // cobranzas y no tiene tests, así que no se lo toca para ahorrar una conexión.
    let inbox: Awaited<ReturnType<typeof syncInboxForAllUsers>> | { error: string }
    try {
      inbox = await syncInboxForAllUsers()
    } catch (e) {
      inbox = { error: e instanceof Error ? e.message : "barrido de bandeja fallido" }
      console.error("cron/cartera email-inbox:", inbox.error)
    }

    return Response.json({ ok: true, ...result, email, inbox })
  } catch (e) {
    // Incluye el aborto por zona horaria incorrecta (assertBusinessTimezone): preferimos un 500
    // ruidoso y ningún envío, antes que despachar cobranzas en el horario equivocado.
    const message = e instanceof Error ? e.message : "Error inesperado"
    console.error("cron/cartera:", message)
    return Response.json({ error: message }, { status: 500 })
  }
}
