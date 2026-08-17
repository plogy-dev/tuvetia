import "server-only"

// El barrido que redacta el briefing de cada clínica, una vez por día.
//
// TRES GUARDAS ANTES DE GASTAR UN TOKEN, en este orden y por este motivo:
//
//   1. `briefing_enabled` — una clínica apagada no llega ni a consultar sus señales.
//   2. ¿Ya hay uno de hoy? — el `unique (clinic_id, fecha)` es la garantía dura, pero preguntarlo
//      antes evita armar el pedido y llamar al modelo para que el INSERT lo rechace después. La
//      restricción protege; esta consulta ahorra.
//   3. ¿Hay algo que contar? — sin pendientes ni citas no se llama. Un briefing que diga "hoy no
//      tenés nada" cuesta lo mismo que uno útil.
//
// FALLA POR CLÍNICA, NO POR BARRIDO: si una revienta, se registra y se sigue con la siguiente. Un
// barrido que se corta en la tercera clínica deja a las demás sin briefing sin que nadie lo note.

import { generateText } from "ai"

import { createAdminClient } from "@/lib/supabase/admin"
import { agentModel } from "@/lib/athos-agent/model"
import { registrarUso } from "@/lib/athos-agent/usage"
import { senalesDeLaClinica } from "@/lib/senales/consultar"
import { bogotaTimeOf, bogotaTodayISO, finDelDiaBogota } from "@/lib/date-utils"
import {
  limpiarBriefing,
  pedidoDelBriefing,
  valeLaPenaRedactar,
  type InsumosDelBriefing,
} from "@/lib/briefing/armar"

/** Cuántas citas del día entran al pedido. Más que esto no cambia un resumen de dos frases. */
const CITAS_EN_EL_PEDIDO = 8

export type ResultadoDelBriefing = {
  clinicas: number
  redactados: number
  /** Apagadas, ya escritas hoy, o sin nada que contar. Cada una es un token NO gastado. */
  /**
   * Por qué NO se redactó. Los motivos están separados a propósito:
   *
   *   · `sin-senales`    la clínica está al día. Es el caso bueno.
   *   · `senales-caidas` NO SE PUDO AVERIGUAR: alguna consulta falló. Se ve igual desde afuera pero
   *                      significa lo contrario, y conflarlos fue lo que hizo indiagnosticable que
   *                      dos clínicas con notas pendientes se saltaran el 2026-08-16.
   *   · `modelo-vacio`   se llamó al modelo —o sea que SE PAGÓ— y devolvió texto vacío.
   */
  omitidos: {
    clinicId: string
    motivo: "apagado" | "ya-existe" | "sin-senales" | "senales-caidas" | "modelo-vacio"
    detalle?: string
  }[]
  fallidos: { clinicId: string; error: string }[]
}

export async function generarBriefings(hoyISO = bogotaTodayISO()): Promise<ResultadoDelBriefing> {
  const admin = createAdminClient()
  const res: ResultadoDelBriefing = { clinicas: 0, redactados: 0, omitidos: [], fallidos: [] }

  // GUARDA 1: sólo las encendidas Y las de plan Pro. Los dos filtros van en SQL y no en el bucle —
  // una clínica apagada, o en free, no tiene que costar ni siquiera la consulta de sus señales.
  //
  // El plan se filtra acá y no dentro del bucle a propósito: es el mismo criterio que
  // `briefing_enabled`, y con la mayoría de las clínicas en free traer todas para descartarlas una
  // por una sería recorrer la tabla entera todos los días para no hacer nada.
  //
  // OJO CON LO QUE ESTO NO ROMPE: las señales del riel de Athos (notas sin aprobar, titulares sin
  // respuesta, refuerzos por vencer) se calculan con consultas a la base y CERO IA — ésas siguen
  // siendo gratis. Lo que es de Pro es el párrafo redactado por el modelo, que es lo único que
  // cuesta.
  const { data: clinicas, error } = await admin
    .from("clinics")
    .select("id, name")
    .eq("briefing_enabled", true)
    .eq("plan", "pro")
  if (error) throw new Error(`No se pudieron leer las clínicas: ${error.message}`)

  const filas = (clinicas ?? []) as { id: string; name: string | null }[]
  res.clinicas = filas.length

  for (const c of filas) {
    try {
      // GUARDA 2: ¿ya hay uno de hoy?
      const { data: existente } = await admin
        .from("clinic_briefings")
        .select("id")
        .eq("clinic_id", c.id)
        .eq("fecha", hoyISO)
        .maybeSingle()
      if (existente) {
        res.omitidos.push({ clinicId: c.id, motivo: "ya-existe" })
        continue
      }

      const { pendientes, caidas } = await senalesDeLaClinica(admin, c.id, hoyISO)

      const finDeHoy = finDelDiaBogota(hoyISO)
      const { data: citasData } = await admin
        .from("appointments")
        .select("starts_at, title, patient:patients(name)")
        .eq("clinic_id", c.id)
        .gte("starts_at", `${hoyISO}T00:00:00-05:00`)
        .lte("starts_at", (finDeHoy ?? new Date()).toISOString())
        .in("status", ["scheduled", "confirmed", "in_progress"])
        .order("starts_at", { ascending: true })
        .limit(CITAS_EN_EL_PEDIDO)

      type CitaFila = { starts_at: string; title: string | null; patient: { name: string } | { name: string }[] | null }
      const citas = ((citasData as unknown as CitaFila[] | null) ?? []).map((a) => {
        const pac = Array.isArray(a.patient) ? a.patient[0] : a.patient
        return {
          hora: bogotaTimeOf(a.starts_at),
          etiqueta: [pac?.name, a.title].filter(Boolean).join(" · ") || "Cita",
        }
      })

      const insumos: InsumosDelBriefing = { pendientes, citas, clinica: c.name }

      // GUARDA 3: sin nada que contar, no se llama al modelo.
      //
      // "No hay nada" y "no pude averiguarlo" se ven IGUAL desde acá —los dos dan cero señales— y
      // significan lo contrario. Se reportan distinto para que un fallo no se lea como una clínica
      // al día: eso fue exactamente lo que pasó en el primer disparo real.
      if (!valeLaPenaRedactar(insumos)) {
        res.omitidos.push(
          caidas.length > 0
            ? { clinicId: c.id, motivo: "senales-caidas", detalle: caidas.join(", ") }
            : { clinicId: c.id, motivo: "sin-senales" },
        )
        continue
      }

      // Con señales caídas SÍ se sigue si algo quedó: el briefing va a estar incompleto, pero un
      // resumen parcial es mejor que ninguno. Queda anotado en la fila para poder explicarlo.
      if (caidas.length > 0) {
        console.warn(`[briefing] la clínica ${c.id} se redacta con señales incompletas: ${caidas.join(", ")}`)
      }

      const elegido = agentModel()
      const salida = await generateText({
        model: elegido.model,
        prompt: pedidoDelBriefing(insumos),
        // Dos o tres frases. El tope es la guarda dura contra un modelo que se entusiasme.
        maxOutputTokens: 220,
      })

      const texto = limpiarBriefing(salida.text)
      if (!texto) {
        // OJO: acá el modelo YA SE PAGÓ. Por eso no comparte motivo con las guardas de arriba, que
        // son las que evitan el gasto.
        res.omitidos.push({ clinicId: c.id, motivo: "modelo-vacio" })
        continue
      }

      // El INSERT puede chocar con `clinic_briefings_unicos_por_dia` si dos barridos corrieron a la
      // vez. No es un error que haya que reportar: significa que el otro ganó y el briefing existe.
      const { error: insErr } = await admin.from("clinic_briefings").insert({
        clinic_id: c.id,
        fecha: hoyISO,
        texto,
        senales: pendientes,
        ai_model: elegido.modelId,
      })
      if (insErr) {
        if (insErr.message.includes("unicos_por_dia") || insErr.message.includes("duplicate")) {
          res.omitidos.push({ clinicId: c.id, motivo: "ya-existe" })
          continue
        }
        throw new Error(insErr.message)
      }

      // El consumo se registra SIEMPRE que se haya llamado al modelo, con su propia superficie: es
      // gasto que ocurre sin que ningún vet lo haya pedido, así que tiene que verse aparte en
      // /admin/costos y no diluido dentro de "agent".
      await registrarUso({
        clinicId: c.id,
        userId: null,
        surface: "briefing",
        elegido,
        usage: salida.usage,
      })

      res.redactados += 1
    } catch (e) {
      // Una clínica que falla no puede llevarse el barrido: las demás siguen.
      console.error(`[briefing] falló la clínica ${c.id}:`, e)
      res.fallidos.push({ clinicId: c.id, error: (e as Error).message })
    }
  }

  return res
}
