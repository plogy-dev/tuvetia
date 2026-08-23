import { barrerSuscripciones } from "@/lib/suscripcion/barrido"
import { reconciliarCobrosColgados } from "@/lib/suscripcion/reconciliar"

// El barrido de suscripciones, DISPARADO A MANO.
//
// ⚠️ ESTE ENDPOINT NO ES EL QUE CORRE TODOS LOS DÍAS. El barrido diario vive dentro de
// `/api/cron/cartera`, que es uno de los dos crons que el plan Hobby de Vercel permite. Esto queda
// para poder correrlo cuando uno quiera —después de arreglar una tarjeta, al probar, o para
// destrabar una reconciliación— sin esperar al horario.
//
// Estuvo un día colgado de un workflow de GitHub Actions. Se quitó: repartía la operación entre dos
// sitios y sacaba el horario del repo, a cambio de nada — el cron de cartera ya existía y ya hacía
// dos trabajos por esta misma restricción.
//
// CORRER DE MÁS ES INOFENSIVO. El barrido es idempotente por la referencia del cobro
// (`tuvetia-<clinica>-<YYYY-MM>-<intento>`), única en nuestra tabla Y en Wompi: dos corridas el
// mismo día no cobran dos veces.

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
    const cobros = await barrerSuscripciones()
    // La reconciliación va DESPUÉS de cobrar, igual que en el cron diario: lo que se acaba de
    // disparar todavía está dentro de su ventana de gracia y no debe tocarse.
    const reconciliacion = await reconciliarCobrosColgados()
    const resultado = { cobros, reconciliacion }
    // El resumen va al log del servidor además de la respuesta: quien mira por qué una clínica no
    // se cobró suele estar mirando los logs.
    console.info("cron/suscripciones:", JSON.stringify(resultado))
    return Response.json(resultado)
  } catch (e) {
    console.error("cron/suscripciones: el barrido falló entero", e)
    return new Response("Error en el barrido", { status: 500 })
  }
}
