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

        const [franjasRes, ocupadosRes, algunaFranjaRes] = await Promise.all([
          admin
            .from("clinic_hours")
            .select("opens_at, closes_at, slot_minutes")
            .eq("clinic_id", clinicId)
            .eq("weekday", localWeekday(date))
            // EL DE LA CLÍNICA (0069): esta herramienta la maneja un titular por WhatsApp y no
            // elige veterinario, así que la ventana que se le ofrece es la de la puerta abierta.
            .is("vet_id", null)
            .order("opens_at"),
          admin
            .from("appointments")
            .select("starts_at, ends_at")
            .eq("clinic_id", clinicId)
            .gte("starts_at", dia.from)
            .lt("starts_at", dia.to)
            .neq("status", "canceled"),
          // ¿TIENE HORARIOS EN ALGÚN DÍA? Es la consulta que distingue los dos ceros — ver abajo.
          // `head: true` no trae filas: sólo el conteo, que es todo lo que hace falta.
          admin
            .from("clinic_hours")
            .select("id", { count: "exact", head: true })
            .eq("clinic_id", clinicId)
            .is("vet_id", null),
        ])
        if (franjasRes.error) return { error: franjasRes.error.message }
        const franjas = (franjasRes.data ?? []) as {
          opens_at: string
          closes_at: string
          slot_minutes: number
        }[]

        // ── LOS DOS CEROS QUE NO SON EL MISMO CERO (31-ago) ─────────────────────────────────────
        //
        // Acá había una sola rama: sin franjas → «La clínica no atiende ese día». Y esa frase es
        // MENTIRA cuando la clínica no cargó NINGÚN horario, porque entonces se devuelve todos los
        // días del año. Fue el silencio del 30-ago, medido en el chat de Santiago Tellez: el
        // titular pidió cita, dijo «Mañana», y el modelo recibió una nota que no podía repetir sin
        // mentir, no podía inventar horas (regla dura del prompt) y ante la duda se calló. Los tres
        // mensajes siguientes —«?», «?», «a qué horas quedó mi cita?»— chocaron con lo mismo.
        //
        // Que la nota sea verdadera no alcanza: tiene que DECIRLE QUÉ HACER. Un modelo al que se le
        // informa un problema y no una salida vuelve al comodín de la casa, que es el silencio.
        if (!algunaFranjaRes.count) {
          return {
            configured: false,
            slots: [],
            motivo: "sin_horarios_configurados",
            note:
              "La clínica todavía no cargó sus horarios en la plataforma, así que NO hay cupos que ofrecer en ningún día. " +
              "NO te calles y NO inventes horas: seguí tomando el pedido igual (nombre, mascota, especie, motivo y correo), " +
              "preguntá qué día y franja le sirven —en palabras, sin comprometer una hora— y usá `solicitar_cita` con `sin_hora`. " +
              "Decile que el equipo le confirma el horario.",
          }
        }
        if (!franjas.length) {
          return {
            configured: false,
            slots: [],
            motivo: "cerrado_ese_dia",
            note: "La clínica no atiende ese día. Ofrecé otro día en vez de cortar la conversación.",
          }
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

  // ── NÚMERO NO RECONOCIDO ────────────────────────────────────────────────────────────────────
  //
  // Sigue sin poder enumerar mascotas ni ver citas: eso es información de OTRA persona, y un
  // teléfono no verifica a nadie.
  //
  // Lo que SÍ puede es pedir cita, que era el pedido: antes se le daban los horarios y se le decía
  // que el equipo lo contactaría — o sea que el cliente nuevo, el que más cuesta conseguir, era el
  // único al que la clínica le respondía a mano.
  //
  // No propone una cita: deja una SOLICITUD. La diferencia no es de nombre, es de base de datos —
  // `create_appointment` exige paciente y titular (0048), y este número no tiene ninguno de los dos.
  // La solicitud carga los nombres tal como los dijo la persona, y al aprobarla se crean titular,
  // paciente y cita de un tirón.
  //
  // POR QUÉ NO SE CREA EL TITULAR AL VUELO: cualquiera que le escriba al número de la clínica
  // podría sembrarle titulares y pacientes en la base, indistinguibles de los reales. Que una
  // persona mire antes de escribir es la misma regla que gobierna el resto de VetGPT.
  if (!ownerId) {
    return {
      ...publicas,

      solicitar_cita: tool({
        description:
          "PIDE una cita para alguien que NO está registrado en la clínica. Úsala sólo si list_my_patients no está disponible. " +
          "Antes tenés que preguntarle NOMBRE, NOMBRE DE LA MASCOTA, ESPECIE y MOTIVO — sin esos cuatro no la llames. " +
          "El correo pedilo, pero si no lo quiere dar mandá la solicitud igual: no es obligatorio. " +
          "Consultá list_available_slots antes de nombrar un horario. Si no hay cupos porque la clínica no cargó su agenda, " +
          "usá sin_hora:true y poné en preferencia lo que la persona dijo ('mañana en la tarde'). " +
          "NO agenda: queda pendiente de que el equipo la confirme; decile que le confirman en breve, nunca que ya quedó agendada.",
        inputSchema: z.object({
          nombre: z.string().min(2).max(80).describe("Nombre de quien escribe, tal como lo dijo"),
          mascota: z.string().min(1).max(60).describe("Nombre de la mascota, tal como lo dijo"),
          // LA ESPECIE SE PREGUNTA (31-ago). `patients.species` es NOT NULL y sin default: sin este
          // dato la ficha nace con un relleno que después nadie corrige. Ver el ejecutor.
          especie: z
            .string()
            .min(2)
            .max(30)
            .describe("Perro, Gato, Ave, Conejo, Roedor, Reptil u Otro — preguntáselo, no lo adivines"),
          email: z
            .string()
            .email()
            .nullable()
            .optional()
            .describe("SÓLO si la persona lo escribió. Nunca lo inventes ni lo deduzcas del nombre."),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Día pedido, YYYY-MM-DD"),
          // OPCIONAL DESDE EL 31-AGO: con `sin_hora` no hay hora que ofrecer, porque la clínica no
          // cargó horarios y `list_available_slots` no devolvió ni un cupo.
          time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("Hora local, de list_available_slots"),
          sin_hora: z
            .boolean()
            .default(false)
            .describe("true cuando no hay cupos que ofrecer: la solicitud queda para que el equipo le ponga la hora"),
          preferencia: z
            .string()
            .max(120)
            .optional()
            .describe("Con sin_hora, la franja que pidió en sus palabras: 'en la tarde', 'temprano'"),
          duration_min: z.number().int().min(5).max(240).default(30),
          reason: z.string().min(1).max(200).describe("Motivo, en las palabras de quien escribe"),
        }),
        execute: async ({ nombre, mascota, especie, email, date, time, sin_hora, preferencia, duration_min, reason }) => {
          // SIN HORA SE ANCLA AL ARRANQUE DEL DÍA. La cita nace con `sin_hora`, que la migración 0096
          // expande a la jornada entera — no es una cita a medianoche, es una cita "ese día", que es
          // exactamente lo que la persona pidió cuando no había cupos que ofrecerle.
          // El chequeo va ANTES de armar el rango: `localRange(date, "")` devuelve null y el vet
          // vería «fecha inválida» cuando la fecha estaba bien y lo que faltaba era la hora.
          if (!sin_hora && !time) {
            return { error: "Falta la hora. Si no hay cupos que ofrecer, mandá sin_hora:true." }
          }
          const rango = localRange(date, sin_hora ? "00:00" : time!, duration_min)
          if (!rango) return invalidDateError(date, time)
          // Con `sin_hora` se compara contra el final del día: pedir "mañana" a las 23:00 de hoy es
          // legítimo, y anclado a las 00:00 el chequeo de "ya pasó" lo rebotaría sin motivo.
          const limite = sin_hora ? new Date(rango.from).getTime() + 86_400_000 : new Date(rango.from).getTime()
          if (limite < Date.now()) {
            return { error: "Ese horario ya pasó. Ofrecé uno futuro." }
          }

          const cuando = sin_hora ? `${date}${preferencia ? ` (${preferencia})` : ""}, sin hora` : `${date} a las ${time}`

          return proposeAction(
            contextoDeAccion(ctx),
            "solicitar_cita",
            {
              nombre: nombre.trim(),
              mascota: mascota.trim(),
              especie: especie.trim(),
              email: email?.trim() || null,
              // EL TELÉFONO SALE DEL CONTEXTO Y NO DEL MODELO. Es el dato con el que se va a crear
              // el titular, y es el único de toda la solicitud que no puede venir de lo que alguien
              // escribió: es de quién llega el mensaje, no lo que el mensaje dice.
              telefono: ctx.conversationKey,
              starts_at: rango.from,
              ends_at: rango.to,
              sin_hora,
              preferencia: preferencia?.trim() || null,
              reason,
            },
            `Solicitud de cita de ${nombre.trim()} para ${mascota.trim()} (${especie.trim()}) — ${cuando}`,
            {},
          )
        },
      }),
    }
  }

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
