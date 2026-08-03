/**
 * Tools del MODO AUTO de WhatsApp — el único camino donde Athos habla solo, y con un TITULAR.
 *
 * ═══ Por qué es un juego aparte y no `buildAthosTools` ═══
 *
 * Dos razones, y las dos son de seguridad.
 *
 * 1. NO HAY RLS. Esta superficie corre desde un webhook, sin sesión: usa `service_role`, que se salta
 *    la RLS por diseño. Las tools del vet se apoyan en que Postgres rechace un id ajeno; acá esa red
 *    no existe, así que **cada consulta filtra por `clinic_id` a mano**. Es lo que el comentario de
 *    `whatsapp/auto-reply.ts` advertía cuando decía que pasarle tools "vería otras clínicas".
 *
 * 2. LA CLÍNICA NO ALCANZA COMO FRONTERA. Del otro lado de la línea hay un dueño de mascota, no un
 *    veterinario. Acotar sólo por clínica dejaría que quien escribe pregunte "¿qué citas tienen hoy?"
 *    y Athos le conteste con los nombres de los pacientes de otros clientes — una fuga ENTRE
 *    TITULARES de la misma clínica, y un problema de Ley 1581. Por eso todo lo que toca datos de
 *    titular lleva **doble filtro: `clinic_id` Y `owner_id`**, y los cupos devuelven horas libres
 *    sin decir nunca de quién es lo ocupado.
 *
 * Si el teléfono no está en `owners`, las tools de titular NI SIQUIERA SE OFRECEN: el modelo no
 * puede llamar lo que no tiene, que es más fuerte que confiar en que respete una instrucción.
 *
 * ═══ Escribir sigue siendo proponer ═══
 *
 * `propose_appointment` no agenda: inserta una acción `proposed` con `tool_name:
 * "create_appointment"` — el MISMO nombre y el MISMO payload que usa el chat del vet, para que la
 * tarjeta de aprobación y el ejecutor no tengan que saber que vino de WhatsApp. El vet aprueba de un
 * toque en vez de escribir la conversación entera.
 */
import { tool } from "ai"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"

import { proposeAction, type AgentContext } from "./actions"
import { calcularCupos, invalidDateError, localRange, localWeekday } from "./agenda"

type SB = SupabaseClient

/** Cuántos días hacia adelante puede mirar un titular. No es agenda pública. */
const DIAS_MAX_ADELANTE = 60

export type AutoReplyContext = {
  clinicId: string
  /** Titular dueño del número que escribe. `null` = teléfono no reconocido. */
  ownerId: string | null
  /** Teléfono normalizado — la clave de conversación donde cuelga la propuesta. */
  conversationKey: string
  model: string
}

function contextoDeAccion(ctx: AutoReplyContext): AgentContext {
  return {
    userId: null, // modo auto: no hay vet detrás
    clinicId: ctx.clinicId,
    source: "auto",
    conversationKey: ctx.conversationKey,
    patientId: null,
    accessToken: null,
    model: ctx.model,
  }
}

export function buildAutoReplyTools(admin: SB, ctx: AutoReplyContext) {
  const { clinicId, ownerId } = ctx

  const publicas = {
    list_available_slots: tool({
      description:
        "Cupos LIBRES para citas en un día concreto. Úsala SIEMPRE antes de ofrecer un horario — nunca inventes disponibilidad. Devuelve horas locales; no dice de quién es lo que está ocupado.",
      inputSchema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Día a consultar, YYYY-MM-DD"),
        duration_min: z.number().int().min(5).max(240).optional(),
      }),
      execute: async ({ date, duration_min }) => {
        const dia = localRange(date, "00:00", 24 * 60)
        if (!dia) return invalidDateError(date)

        // Un titular no navega la agenda del año que viene ni pregunta por ayer.
        const hoy = Date.now()
        const inicio = new Date(dia.from).getTime()
        if (inicio < hoy - 86_400_000) {
          return { error: "Esa fecha ya pasó. Preguntá por un día de hoy en adelante." }
        }
        if (inicio > hoy + DIAS_MAX_ADELANTE * 86_400_000) {
          return { error: `Sólo se puede consultar hasta ${DIAS_MAX_ADELANTE} días hacia adelante.` }
        }

        const [franjasRes, ocupadosRes] = await Promise.all([
          admin
            .from("clinic_hours")
            .select("opens_at, closes_at, slot_minutes")
            .eq("clinic_id", clinicId)
            .eq("weekday", localWeekday(date))
            .order("opens_at"),
          admin
            .from("appointments")
            .select("starts_at, ends_at")
            .eq("clinic_id", clinicId)
            .gte("starts_at", dia.from)
            .lt("starts_at", dia.to)
            .neq("status", "canceled"),
        ])
        if (franjasRes.error) return { error: franjasRes.error.message }
        const franjas = (franjasRes.data ?? []) as {
          opens_at: string
          closes_at: string
          slot_minutes: number
        }[]
        if (!franjas.length) {
          return { configured: false, slots: [], note: "La clínica no atiende ese día." }
        }
        return {
          configured: true,
          date,
          slots: calcularCupos({
            date,
            franjas,
            ocupados: (ocupadosRes.data ?? []) as { starts_at: string; ends_at: string }[],
            durationMin: duration_min,
          }),
        }
      },
    }),
  }

  // Sin titular reconocido no se ofrece nada más: un número desconocido no puede enumerar mascotas,
  // ver citas ni proponer nada.
  if (!ownerId) return publicas

  return {
    ...publicas,

    list_my_patients: tool({
      description:
        "Las mascotas registradas a nombre de QUIEN ESCRIBE. Úsala para saber de cuál te habla y para obtener su patient_id antes de proponer una cita.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await admin
          .from("patients")
          .select("id, name, species, breed")
          .eq("clinic_id", clinicId)
          .eq("owner_id", ownerId)
          .eq("is_deceased", false)
          .order("name")
          .limit(20)
        if (error) return { error: error.message }
        return { patients: data ?? [] }
      },
    }),

    list_my_appointments: tool({
      description:
        "Las próximas citas de QUIEN ESCRIBE. Úsala para 'cuándo tengo la cita' o antes de proponer reprogramar. Sólo devuelve las suyas.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await admin
          .from("appointments")
          .select("id, title, starts_at, ends_at, status, patient:patients!appointments_patient_id_fkey(name)")
          .eq("clinic_id", clinicId)
          .eq("owner_id", ownerId)
          .gte("starts_at", new Date().toISOString())
          .neq("status", "canceled")
          .order("starts_at")
          .limit(10)
        if (error) return { error: error.message }
        return { appointments: data ?? [] }
      },
    }),

    propose_appointment: tool({
      description:
        "PROPONE una cita para una mascota de quien escribe. NO la agenda: queda pendiente de que el equipo de la clínica la confirme. Consultá list_available_slots antes y usá un patient_id de list_my_patients. Decile al titular que le confirmarán en breve — nunca que ya quedó agendada.",
      inputSchema: z.object({
        patient_id: z.string().uuid().describe("id de la mascota, de list_my_patients"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string().regex(/^\d{2}:\d{2}$/).describe("Hora local, de list_available_slots"),
        duration_min: z.number().int().min(5).max(240).default(30),
        reason: z.string().min(1).max(200).describe("Motivo, en las palabras del titular"),
      }),
      execute: async ({ patient_id, date, time, duration_min, reason }) => {
        // El paciente tiene que ser DE ESTE titular. Sin esta comprobación, un patient_id inventado
        // (o sacado de otra conversación) agendaría sobre la mascota de otra persona: acá no hay RLS
        // que lo impida.
        const { data: paciente, error: pErr } = await admin
          .from("patients")
          .select("id, name")
          .eq("id", patient_id)
          .eq("clinic_id", clinicId)
          .eq("owner_id", ownerId)
          .maybeSingle()
        if (pErr) return { error: pErr.message }
        if (!paciente) {
          return { error: "Esa mascota no está registrada a tu nombre. Consultá list_my_patients." }
        }

        const rango = localRange(date, time, duration_min)
        if (!rango) return invalidDateError(date, time)
        if (new Date(rango.from).getTime() < Date.now()) {
          return { error: "Ese horario ya pasó. Ofrecé uno futuro." }
        }

        const nombre = (paciente as { name: string }).name
        return proposeAction(
          contextoDeAccion(ctx),
          "create_appointment",
          {
            title: `${nombre} — ${reason}`,
            starts_at: rango.from,
            ends_at: rango.to,
            patient_id,
            owner_id: ownerId,
            reason,
            notes: "Pedida por el titular por WhatsApp.",
          },
          `Cita para ${nombre} el ${date} a las ${time} — pedida por WhatsApp`,
          { patientId: patient_id, ownerId },
        )
      },
    }),
  }
}
