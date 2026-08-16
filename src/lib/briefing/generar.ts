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
  omitidos: { clinicId: string; motivo: "apagado" | "ya-existe" | "nada-que-contar" }[]
  fallidos: { clinicId: string; error: string }[]
}

export async function generarBriefings(hoyISO = bogotaTodayISO()): Promise<ResultadoDelBriefing> {
  const admin = createAdminClient()
  const res: ResultadoDelBriefing = { clinicas: 0, redactados: 0, omitidos: [], fallidos: [] }

  // GUARDA 1: sólo las encendidas. El filtro va en SQL y no en el bucle — una clínica apagada no
  // tiene que costar ni siquiera la consulta de sus señales.
  const { data: clinicas, error } = await admin
    .from("clinics")
    .select("id, name")
    .eq("briefing_enabled", true)
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

      const { pendientes } = await senalesDeLaClinica(admin, c.id, hoyISO)

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
      if (!valeLaPenaRedactar(insumos)) {
        res.omitidos.push({ clinicId: c.id, motivo: "nada-que-contar" })
        continue
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
        res.omitidos.push({ clinicId: c.id, motivo: "nada-que-contar" })
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
