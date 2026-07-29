import { runCarteraForAllClinics } from "@/lib/cartera/run-all"

// Barrido de cartera: recorre las clínicas con recordatorios activos, programa los pasos que
// falten y despacha los vencidos. El motor ya existía y estaba cubierto por tests, pero no tenía
// quién lo llamara — o sea que los recordatorios nunca salían solos.
//
// Frecuencia: cada hora dentro de la ventana hábil (ver vercel.json). El cron NO decide si se
// puede contactar: eso lo resuelve el gate de la Ley 2300 dentro del motor (ventana horaria, un
// contacto por día, festivos, canal autorizado). Correr de más es inofensivo — el barrido es
// idempotente y lo que no toca se reprograma.
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
    return Response.json({ ok: true, ...result })
  } catch (e) {
    // Incluye el aborto por zona horaria incorrecta (assertBusinessTimezone): preferimos un 500
    // ruidoso y ningún envío, antes que despachar cobranzas en el horario equivocado.
    const message = e instanceof Error ? e.message : "Error inesperado"
    console.error("cron/cartera:", message)
    return Response.json({ error: message }, { status: 500 })
  }
}
