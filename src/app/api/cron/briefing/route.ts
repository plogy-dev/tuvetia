import { generarBriefings } from "@/lib/briefing/generar"

// El briefing diario de cada clínica.
//
// POR QUÉ NO ES UN CRON DE VERCEL. El plan es Hobby y permite DOS crons con disparo diario; los dos
// cupos están usados (`purge-audio` y `cartera`, ver `vercel.json`). Así que este endpoint lo llama
// una GitHub Action, igual que el barrido extra de cartera — el mismo camino que ya está probado.
//
// ES LO ÚNICO DE LA CAPA AGÉNTICA QUE GASTA IA, y por eso las guardas están del lado del que llama
// al modelo y no del prompt: una clínica apagada, una que ya tiene su briefing de hoy, o una sin
// nada que contar NO llegan a la llamada. Ver `lib/briefing/generar.ts`.
//
// Correr de más es inofensivo: `clinic_briefings` tiene `unique (clinic_id, fecha)`, así que un
// segundo disparo del mismo día no redacta nada — y como la guarda se consulta ANTES de armar el
// pedido, tampoco gasta.

export const maxDuration = 300 // recorre todas las clínicas en serie

export async function GET(req: Request) {
  // Estricto a propósito, igual que el cron de cartera: sin el secreto, 503 y no corre nada. La
  // variante permisiva (`if (secret && ...)`) deja el endpoint ABIERTO justo cuando la env falta,
  // que es cuando menos te enterás — y acá cada llamada cuesta tokens.
  const secret = process.env.CRON_SECRET
  if (!secret) return new Response("Cron no configurado (falta CRON_SECRET)", { status: 503 })
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  try {
    const r = await generarBriefings()
    return Response.json(r)
  } catch (e) {
    // El barrido ya aísla los fallos POR CLÍNICA; llegar acá significa que se cayó algo de arriba
    // —leer la lista de clínicas, típicamente—, y eso sí es un fallo del barrido entero.
    console.error("[cron/briefing] el barrido no pudo arrancar:", e)
    return new Response(`Error: ${(e as Error).message}`, { status: 500 })
  }
}
