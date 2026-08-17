import { barrerSuscripciones } from "@/lib/suscripcion/barrido"

// El barrido diario de suscripciones: cobra lo que vence, reintenta lo que falló, baja lo cancelado.
//
// DÓNDE CORRE. En GitHub Actions (`.github/workflows/renovacion-suscripciones.yml`), no en Vercel:
// el plan Hobby permite 2 crons diarios y los dos cupos están usados desde hace meses
// (`purge-audio` y `cartera`). Es el mismo camino que ya tomó el briefing diario.
//
// A QUÉ HORA. 13:00 UTC = 8:00 en Colombia. Antes que el barrido de cartera (9:00) a propósito: si
// una clínica cae a free por falta de pago, conviene que caiga antes de que el motor de cartera
// intente usar la IA que ya no tiene.
//
// CORRER DE MÁS ES INOFENSIVO. El barrido es idempotente por la referencia del cobro: dos corridas
// el mismo día no cobran dos veces. Por eso puede vivir en Actions, que no tiene SLA y a veces
// dispara tarde, dos veces, o no dispara.

export const maxDuration = 300

export async function GET(req: Request) {
  // Estricto: sin secreto, 503 y no se corre nada. La variante permisiva —`if (secret && ...)`—
  // deja el endpoint ABIERTO justo cuando la variable falta, que es cuando menos te enterás. Este
  // barrido le cobra a tarjetas de verdad.
  const secret = process.env.CRON_SECRET
  if (!secret) return new Response("Cron no configurado (falta CRON_SECRET)", { status: 503 })
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  try {
    const resultado = await barrerSuscripciones()
    // El resumen va al log del servidor además de la respuesta: quien mira por qué una clínica no
    // se cobró suele estar mirando los logs, no la salida del workflow.
    console.info("cron/suscripciones:", JSON.stringify(resultado))
    return Response.json(resultado)
  } catch (e) {
    console.error("cron/suscripciones: el barrido falló entero", e)
    return new Response("Error en el barrido", { status: 500 })
  }
}
