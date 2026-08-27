/**
 * Tools del agente Athos (Vercel AI SDK).
 *
 * - LECTURA: ejecutan directo con el supabase client AUTENTICADO del vet — RLS protege: aunque el
 *   modelo "elija" un id ajeno, Postgres lo rechaza.
 * - ESCRITURA: no ejecutan nada — insertan una acción 'proposed' (ver actions.ts) que el vet
 *   aprueba/edita/rechaza en una tarjeta. Athos propone, el vet ejecuta.
 *
 * Colombia no tiene DST: los horarios locales se fijan con offset -05:00.
 */
import { tool } from "ai"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"

import { proposeAction, type AgentContext } from "./actions"
import {
  calcularCupos,
  invalidDateError,
  localRange,
  localToIso,
  localWeekday,
  TZ_OFFSET,
} from "./agenda"
import { CONEXION_CORREO } from "./conversacion"
import {
  franjasQueMandan,
  type FranjaDeAlguien,
} from "@/lib/agenda/horario-de-cada-quien"
import { buscarCorreos, estadoConexion, leerConversacion } from "@/lib/composio/correo"

type SB = SupabaseClient

// La hora local y el cálculo de cupos viven en `./agenda` desde que el modo auto de WhatsApp también
// los necesita: son las mismas reglas con otro cliente de base. Se re-exporta `localToIso` porque
// `__tests__/agent-smoke.test.ts` lo importa desde acá.
export { localToIso, TZ_OFFSET }

const digits = (s: string) => s.replace(/\D/g, "")

function escapeLike(q: string): string {
  return q.trim().replace(/[%_\\]/g, "\\$&")
}

// Cómo lo dice el vet → cómo está guardado en `patients.species`. Solo hacen falta los sinónimos
// que un ilike no resuelve solo (ilike ya ignora mayúsculas, pero "canino" no se parece a 'Perro').
const ESPECIE_DB: Record<string, string> = {
  perro: "Perro",
  canino: "Perro",
  gato: "Gato",
  felino: "Gato",
}

/** Fecha local (YYYY-MM-DD) de hace `n` años — para traducir edades a cotas sobre birth_date. */
function fechaHaceAnios(n: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - n)
  return d.toISOString().slice(0, 10)
}

/** Edad en años cumplidos, o null si la ficha no tiene fecha de nacimiento. */
function edadAnios(birthDate: string | null): number | null {
  if (!birthDate) return null
  const [y, m, d] = birthDate.split("-").map(Number)
  if (!y || !m || !d) return null
  const hoy = new Date()
  let edad = hoy.getFullYear() - y
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) edad--
  return edad
}

// ─── Tools ───────────────────────────────────────────────────────────────────

/**
 * ¿Falta conectar el correo? Devuelve el resultado a mostrar, o null si está todo bien.
 *
 * Se comprueba ANTES de proponer, no al ejecutar. Si no, Athos redactaría el correo, el vet lo
 * aprobaría, y recién ahí se enteraría de que no tiene la cuenta conectada — habiendo perdido el
 * texto y sin entender por qué falló.
 */
async function faltaCorreoConectado(
  userId: string | null,
): Promise<{ error: string; needs_connection?: string } | null> {
  if (!userId) {
    return { error: "El correo se envía con la cuenta del veterinario, y este turno no tiene una." }
  }
  const { conectado } = await estadoConexion(userId)
  if (conectado) return null
  return {
    error: "Todavía no conectaste tu correo, así que no puedo enviarlo por vos.",
    needs_connection: CONEXION_CORREO,
  }
}

export function buildAthosTools(supabase: SB, ctx: AgentContext) {
  return {
    // ── LECTURA ──────────────────────────────────────────────────────────────
    search_patients: tool({
      description:
        "Busca pacientes de la clínica por nombre de la mascota o del titular. Devuelve hasta 10 con id, especie, raza y titular. Úsala SIEMPRE antes de operar sobre un paciente existente — necesitas el id real.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Texto a buscar (mascota o titular)"),
      }),
      execute: async ({ query }) => {
        const pattern = `%${escapeLike(query)}%`
        const SELECT = "id, name, species, breed, owner_id, owner:owners(id, full_name, phone)"
        const [byName, ownerHits] = await Promise.all([
          supabase.from("patients").select(SELECT).ilike("name", pattern).limit(10),
          supabase.from("owners").select("id").ilike("full_name", pattern).limit(10),
        ])
        if (byName.error) return { error: byName.error.message }
        type Row = {
          id: string
          name: string
          species: string
          breed: string | null
          owner_id: string
          owner: { id: string; full_name: string; phone: string | null } | null
        }
        const map = new Map<string, Row>()
        for (const p of (byName.data ?? []) as unknown as Row[]) map.set(p.id, p)
        const ownerIds = ((ownerHits.data ?? []) as { id: string }[]).map((o) => o.id)
        if (ownerIds.length) {
          const { data } = await supabase.from("patients").select(SELECT).in("owner_id", ownerIds).limit(10)
          for (const p of (data ?? []) as unknown as Row[]) map.set(p.id, p)
        }
        const rows = [...map.values()].slice(0, 10)
        return {
          count: rows.length,
          patients: rows.map((p) => ({
            id: p.id,
            name: p.name,
            species: p.species,
            breed: p.breed,
            owner_id: p.owner_id,
            owner: p.owner?.full_name ?? null,
            owner_phone: p.owner?.phone ?? null,
          })),
        }
      },
    }),

    search_patients_by_features: tool({
      description:
        "Encuentra pacientes cuando el veterinario NO sabe el nombre y describe al paciente por características: " +
        "especie, raza, sexo, edad, o lo que pasó en una consulta previa ('me acuerdo que vino hace un mes con diarreas'). " +
        "Devuelve hasta 10 candidatos con su última consulta — presentáselos y pedile que confirme cuál es antes de " +
        "operar con el id. Si la respuesta trae `total`, hay más candidatos que los mostrados: pedí más señas para afinar.",
      inputSchema: z.object({
        species: z.string().optional().describe("Especie: 'perro'/'canino', 'gato'/'felino'… (se normaliza sola)"),
        breed: z.string().optional().describe("Raza, aunque sea parcial ('labrador')"),
        sex: z.enum(["macho", "hembra"]).optional(),
        motivo_o_sintomas: z
          .string()
          .optional()
          .describe("Qué pasó en la consulta previa, en pocas palabras ('diarrea', 'vacuna', 'cojera')"),
        dias_atras: z
          .number()
          .int()
          .min(1)
          .max(3650)
          .default(90)
          .describe("Hasta cuántos días atrás mirar las consultas ('hace un mes' → 30–45). Solo aplica con motivo_o_sintomas."),
        edad_min_anios: z.number().int().min(0).max(50).optional(),
        edad_max_anios: z.number().int().min(0).max(50).optional(),
      }),
      execute: async ({ species, breed, sex, motivo_o_sintomas, dias_atras, edad_min_anios, edad_max_anios }) => {
        if (!species && !breed && !sex && !motivo_o_sintomas && edad_min_anios == null && edad_max_anios == null)
          return { error: "Necesito al menos una característica: especie, raza, sexo, edad o algo de la consulta previa." }

        // Con motivo, el punto de partida son las CONSULTAS (ahí vive "vino con diarreas") y los
        // pacientes se filtran después sobre esos ids — una consulta por tabla, sin N+1.
        const ultimaConsulta = new Map<string, { fecha: string; motivo: string | null }>()
        let idsPorMotivo: string[] | null = null
        if (motivo_o_sintomas) {
          const desde = new Date(Date.now() - dias_atras * 86_400_000).toISOString()
          const { data, error } = await supabase
            .from("consultations")
            .select("patient_id, chief_complaint, started_at")
            .ilike("chief_complaint", `%${escapeLike(motivo_o_sintomas)}%`)
            .gte("started_at", desde)
            .order("started_at", { ascending: false })
            .limit(200)
          if (error) return { error: error.message }
          // Vienen de la más reciente a la más vieja: la primera de cada paciente ES su última
          // consulta coincidente — la ultima_consulta del resultado sale de acá, sin otro viaje.
          for (const c of (data ?? []) as { patient_id: string; chief_complaint: string | null; started_at: string }[]) {
            if (!ultimaConsulta.has(c.patient_id))
              ultimaConsulta.set(c.patient_id, { fecha: c.started_at, motivo: c.chief_complaint })
          }
          // Tope de 100 ids: PostgREST pasa el `in` por query string y sin tope la URL crece sin límite.
          idsPorMotivo = [...ultimaConsulta.keys()].slice(0, 100)
          if (!idsPorMotivo.length)
            return {
              count: 0,
              patients: [],
              note: `Ninguna consulta de los últimos ${dias_atras} días menciona "${motivo_o_sintomas}". Probá con otra palabra o una ventana mayor.`,
            }
        }

        type Candidato = {
          id: string
          name: string
          species: string
          breed: string | null
          sex: string | null
          birth_date: string | null
          owner: { full_name: string } | null
        }
        // Como en las demás tools de lectura: sin .eq('clinic_id') explícito — el cliente es el del
        // vet y RLS ya acota todo a su clínica.
        let q = supabase
          .from("patients")
          .select("id, name, species, breed, sex, birth_date, owner:owners(full_name)", { count: "exact" })
        if (idsPorMotivo) q = q.in("id", idsPorMotivo)
        if (species) {
          const key = species.trim().toLowerCase()
          q = q.ilike("species", ESPECIE_DB[key] ?? key)
        }
        if (breed) q = q.ilike("breed", `%${escapeLike(breed)}%`)
        if (sex) q = q.eq("sex", sex === "macho" ? "male" : "female")
        // La edad no está materializada: se traduce a cotas sobre birth_date. "Entre 2 y 5 años" =
        // nació hace ≤6 y ≥2 años; el día exacto del cumpleaños no importa para candidatear.
        if (edad_min_anios != null) q = q.lte("birth_date", fechaHaceAnios(edad_min_anios))
        if (edad_max_anios != null) q = q.gte("birth_date", fechaHaceAnios(edad_max_anios + 1))
        // Con motivo NO se limita acá: el orden útil es "consulta coincidente más reciente primero",
        // y ese dato no está en patients — se ordena abajo con lo que ya trajo consultations.
        if (!idsPorMotivo) q = q.order("name").limit(10)
        const { data: pacientes, count, error } = await q
        if (error) return { error: error.message }
        let rows = (pacientes ?? []) as unknown as Candidato[]

        if (idsPorMotivo) {
          rows.sort((a, b) =>
            (ultimaConsulta.get(b.id)?.fecha ?? "").localeCompare(ultimaConsulta.get(a.id)?.fecha ?? ""),
          )
          rows = rows.slice(0, 10)
        } else if (rows.length) {
          // Camino directo por ficha: UNA consulta extra trae las últimas consultas de los 10
          // candidatos juntos (PostgREST no tiene DISTINCT ON: se trae ordenado y gana la primera
          // de cada paciente). Acá no se acota por dias_atras — es contexto, no filtro.
          const { data } = await supabase
            .from("consultations")
            .select("patient_id, chief_complaint, started_at")
            .in("patient_id", rows.map((p) => p.id))
            .order("started_at", { ascending: false })
            .limit(100)
          for (const c of (data ?? []) as { patient_id: string; chief_complaint: string | null; started_at: string }[]) {
            if (!ultimaConsulta.has(c.patient_id))
              ultimaConsulta.set(c.patient_id, { fecha: c.started_at, motivo: c.chief_complaint })
          }
        }

        const total = count ?? rows.length
        return {
          count: rows.length,
          // `total` solo cuando quedaron candidatos afuera: es la señal de "hay más, afiná la búsqueda".
          ...(total > rows.length ? { total } : {}),
          patients: rows.map((p) => ({
            patient_id: p.id,
            name: p.name,
            species: p.species,
            breed: p.breed,
            sex: p.sex,
            edad_anios: edadAnios(p.birth_date),
            owner: p.owner?.full_name ?? null,
            ultima_consulta: ultimaConsulta.get(p.id) ?? null,
          })),
        }
      },
    }),

    get_patient_summary: tool({
      description:
        "Resumen clínico de un paciente: ficha (especie, raza, sexo, nacimiento, peso), ALERGIAS (las " +
        "severas son bloqueantes para cualquier plan), medicación activa y vacunas con su próxima dosis.",
      inputSchema: z.object({ patient_id: z.string().uuid() }),
      execute: async ({ patient_id }) => {
        const [patient, allergies, vacunas, meds] = await Promise.all([
          supabase
            .from("patients")
            .select("id, name, species, breed, sex, birth_date, weight_kg, owner:owners(id, full_name, phone, email)")
            .eq("id", patient_id)
            .maybeSingle(),
          supabase.from("allergies").select("allergen, severity, reaction").eq("patient_id", patient_id),
          // Las vacunas faltaban en el resumen (hallado probando, 27-ago): el agente no podía decir
          // «Luna tiene la quíntuple vencida» ni mirando la ficha entera. Es de las rutinas que más
          // ocupan a una clínica y era el único bloque de la ficha al que no llegaba.
          supabase
            .from("vaccines")
            .select("vaccine_name, administered_at, next_dose_at")
            .eq("patient_id", patient_id)
            .order("next_dose_at", { ascending: true, nullsFirst: false }),
          supabase
            .from("medications")
            .select("drug_name, dose, frequency, is_chronic, end_date")
            .eq("patient_id", patient_id)
            // El día de BOGOTÁ, no el del proceso: `end_date` es DATE (calendario del negocio) y
            // con el día UTC, de 19:00 a medianoche un tratamiento que termina HOY —aún activo—
            // desaparecía del resumen que el agente usa para responder (revisión del 26-ago).
            .or(
              `end_date.is.null,end_date.gte.${new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10)}`,
            ),
        ])
        if (patient.error) return { error: patient.error.message }
        if (!patient.data) return { error: "No se encontró el paciente." }
        return {
          patient: patient.data,
          allergies: allergies.data ?? [],
          severe_allergies: ((allergies.data ?? []) as { allergen: string; severity: string }[])
            .filter((a) => a.severity === "severe")
            .map((a) => a.allergen),
          active_medications: meds.data ?? [],
          vaccines: vacunas.data ?? [],
          // Los refuerzos VENCIDOS, ya separados. Comparar fechas en prosa es donde un LLM se
          // equivoca sin que nadie lo note, así que la cuenta la hace el código.
          overdue_boosters: ((vacunas.data ?? []) as { vaccine_name: string; next_dose_at: string | null }[])
            .filter((v) => v.next_dose_at && v.next_dose_at < new Date().toISOString().slice(0, 10))
            .map((v) => `${v.vaccine_name} (venció ${v.next_dose_at})`),
        }
      },
    }),

    get_owner_by_phone: tool({
      description:
        "Busca el titular (dueño) por número de teléfono — útil en la bandeja de WhatsApp para saber quién escribe y qué mascotas tiene.",
      inputSchema: z.object({ phone: z.string().min(6) }),
      execute: async ({ phone }) => {
        const last10 = digits(phone).slice(-10)
        const { data, error } = await supabase
          .from("owners")
          .select("id, full_name, phone, email, patients(id, name, species)")
          .ilike("phone", `%${last10}%`)
          .limit(3)
        if (error) return { error: error.message }
        return { count: (data ?? []).length, owners: data ?? [] }
      },
    }),

    list_appointments_on_day: tool({
      description:
        "Citas de la clínica en un día (YYYY-MM-DD, hora local). Úsala para responder '¿qué tengo mañana?' o para encontrar el id de una cita antes de proponer moverla.",
      inputSchema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
      execute: async ({ date }) => {
        const day = localRange(date, "00:00", 24 * 60)
        if (!day) return invalidDateError(date)
        const { from, to } = day
        const { data, error } = await supabase
          .from("appointments")
          .select("id, title, reason, status, starts_at, ends_at, patient:patients(name), owner:owners(full_name)")
          .gte("starts_at", from)
          .lt("starts_at", to)
          .order("starts_at", { ascending: true })
        if (error) return { error: error.message }
        return { count: (data ?? []).length, appointments: data ?? [] }
      },
    }),

    // ── LAS VACUNAS, QUE NO ESTABAN EN NINGUNA HERRAMIENTA ──────────────────────────────────
    //
    // Hallado probando (27-ago). Al preguntarle «¿a qué pacientes les toca refuerzo este mes?»,
    // VetGPT contestó que veía «2 refuerzos por vencer, uno ya vencido» —eso llega por las señales
    // de la clínica, que son un CONTEO— pero que no alcanzaba a ver a qué pacientes correspondían,
    // y se negó a inventar nombres. El comportamiento fue impecable; la capacidad no existía.
    //
    // Y no era sólo esta pregunta: `get_patient_summary` trae alergias y medicación pero tampoco
    // vacunas, así que tampoco podía decir «Luna tiene la quíntuple vencida» mirando una ficha.
    // El recordatorio de refuerzos es de las rutinas que más ocupan a una clínica, y el asistente
    // era ciego a ella entera.
    //
    // `next_dose_at` es la fecha que importa: `administered_at` cuenta la historia, `next_dose_at`
    // es lo accionable. Por eso ordena por ahí y trae también las VENCIDAS — un refuerzo atrasado
    // es más urgente que uno que vence la semana que viene, y esconderlo sería lo contrario de
    // ayudar.
    list_vaccine_boosters: tool({
      description:
        "Refuerzos de vacuna con su fecha de próxima dosis, entre dos fechas (YYYY-MM-DD). Úsala " +
        "para '¿a quién le toca refuerzo este mes?' o '¿qué vacunas están vencidas?'. Incluye las " +
        "VENCIDAS si el rango las abarca: un refuerzo atrasado es más urgente que uno próximo. " +
        "Devuelve el paciente y su titular, para poder avisarle.",
      inputSchema: z.object({
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      execute: async ({ desde, hasta }) => {
        const { data, error } = await supabase
          .from("vaccines")
          // El titular cuelga del paciente, en un solo embed anidado: hay que poder avisarle, y
          // sin el teléfono la respuesta obliga a una segunda pregunta.
          .select(
            "vaccine_name, administered_at, next_dose_at, patient:patients(id, name, species, owner:owners(full_name, phone))",
          )
          .not("next_dose_at", "is", null)
          .gte("next_dose_at", desde)
          .lte("next_dose_at", hasta)
          .order("next_dose_at", { ascending: true })
        if (error) return { error: error.message }
        const hoy = new Date().toISOString().slice(0, 10)
        const filas = (data ?? []).map((v) => {
          const r = v as unknown as { next_dose_at: string }
          // El estado se calcula acá y no se le deja al modelo: comparar fechas en prosa es
          // justo donde un LLM se equivoca sin que nadie lo note.
          return { ...v, estado: r.next_dose_at < hoy ? "vencida" : "por vencer" }
        })
        return { count: filas.length, refuerzos: filas }
      },
    }),

    get_clinic_hours: tool({
      description:
        "Horarios de atención de la clínica por día de semana (0=domingo … 6=sábado). Si está vacío, la clínica no los configuró — dile al vet que los cargue en Configuración. " +
        "Devuelve además `mine` cuando quien pregunta tiene horario propio distinto al de la clínica.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("clinic_hours")
          .select("weekday, opens_at, closes_at, slot_minutes, vet_id")
          // La fila de la clínica y la propia, en una sola consulta. `vet_id` viaja en el select
          // porque es lo único que las distingue.
          .or(ctx.userId ? `vet_id.is.null,vet_id.eq.${ctx.userId}` : "vet_id.is.null")
          .order("weekday")
          .order("opens_at")
        if (error) return { error: error.message }
        const filas = (data ?? []) as (FranjaDeAlguien & { slot_minutes: number })[]
        const deLaClinica = filas.filter((f) => f.vet_id === null)
        // SE DEVUELVEN LOS DOS, no el efectivo ya resuelto. Que el modelo sepa que "la clínica abre
        // 8–18 pero vos atendés 14–20" es lo que le deja responder bien las dos preguntas: la del
        // titular ("¿a qué hora abren?") y la del vet ("¿hasta qué hora tengo hoy?").
        const propias = filas.filter((f) => f.vet_id !== null)
        return {
          configured: deLaClinica.length > 0,
          hours: deLaClinica,
          ...(propias.length ? { mine: propias } : {}),
        }
      },
    }),

    list_available_slots: tool({
      description:
        "Cupos DISPONIBLES para citas en un día: horarios de la clínica menos las citas del veterinario. " +
        "Úsala SIEMPRE antes de proponer una cita — nunca inventes disponibilidad. " +
        "Pasá `vet_id`: la agenda es de UNA persona, y sin él se restan las citas de TODOS y la clínica " +
        "parece llena cuando sólo un veterinario está ocupado.",
      inputSchema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        duration_min: z.number().int().min(5).max(240).optional().describe("Duración deseada (default: slot de la clínica)"),
        vet_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            "De quién es la agenda. Omitirlo devuelve los cupos libres para TODOS a la vez, que es más " +
              "restrictivo de lo real en una clínica con varios veterinarios.",
          ),
      }),
      execute: async ({ date, duration_min, vet_id }) => {
        const day = localRange(date, "00:00", 24 * 60)
        // Sin la guarda, un `2026-02-30` daba weekday=NaN y una consulta con rango inválido:
        // el vet recibía "no hay horarios" en vez de saber que la fecha no existe.
        if (!day) return invalidDateError(date)
        const weekday = localWeekday(date)
        const [{ data: hours, error: hErr }, apptsRes] = await Promise.all([
          supabase
            .from("clinic_hours")
            .select("weekday, opens_at, closes_at, slot_minutes, vet_id")
            // LAS DOS DE UNA VEZ: la de la clínica y la de esta persona (0069). Cuál manda lo
            // decide `franjasQueMandan` abajo, no la consulta — la regla es "si definió ese día,
            // el suyo; si no, el de la clínica", y eso no se escribe en un filtro sin dos viajes.
            .or(vet_id ? `vet_id.is.null,vet_id.eq.${vet_id}` : "vet_id.is.null")
            .eq("weekday", weekday)
            .order("opens_at"),
          // LA AGENDA ES DE UNA PERSONA, no de la clínica. Sin filtrar por vet, una clínica con tres
          // veterinarios aparece ocupada cuando sólo uno lo está — y ya hay clínicas con más de uno.
          //
          // Los estados son los MISMOS que `ESTADOS_VIVOS` de `calendario/page.tsx` y que el trigger
          // de la 0067. Antes esto excluía sólo `canceled`, así que un `no_show` seguía tapando un
          // cupo que en realidad quedó libre.
          (vet_id
            ? supabase.from("appointments").select("starts_at, ends_at, status").eq("vet_id", vet_id)
            : supabase.from("appointments").select("starts_at, ends_at, status")
          )
            .gte("starts_at", day.from)
            .lt("starts_at", day.to)
            .in("status", ["scheduled", "confirmed", "in_progress"]),
        ])
        if (hErr) return { error: hErr.message }
        // EL HORARIO DE QUIEN ATIENDE, no el de la puerta. Un vet que entra a las 2 aparecía libre
        // a las 8 porque la clínica abre a las 8 — es el mismo defecto que hacía salir los correos
        // con la hora equivocada ("el horario es el suyo y no es el mío", 17-ago).
        const franjas = franjasQueMandan(
          (hours ?? []) as (FranjaDeAlguien & { slot_minutes: number })[],
          vet_id ?? null,
        )
        if (!franjas.length)
          return {
            configured: false,
            slots: [],
            note: "La clínica no tiene horario configurado para ese día (o no cargó sus horarios en Configuración).",
          }
        const slots = calcularCupos({
          date,
          franjas,
          ocupados: (apptsRes.data ?? []) as { starts_at: string; ends_at: string }[],
          durationMin: duration_min,
        })
        // `personal` para que el modelo pueda decirlo: "según TU horario, no el de la clínica".
        return { configured: true, date, slots, personal: franjas.some((f) => f.vet_id !== null) }
      },
    }),

    search_whatsapp_conversation: tool({
      description:
        "Últimos mensajes de WhatsApp entre la clínica y un teléfono (lo que escribió el titular y lo que respondió la clínica). Úsala para dar contexto antes de redactar una respuesta.",
      inputSchema: z.object({
        phone: z.string().min(6).describe("Teléfono del titular (cualquier formato)"),
        limit: z.number().int().min(1).max(30).optional(),
      }),
      execute: async ({ phone, limit }) => {
        const last10 = digits(phone).slice(-10)
        const { data, error } = await supabase
          .from("whatsapp_messages")
          .select("direction, body, media_type, created_at, wa_phone_from, wa_phone_to")
          .or(`wa_phone_from.ilike.%${last10},wa_phone_to.ilike.%${last10}`)
          .order("created_at", { ascending: false })
          .limit(limit ?? 15)
        if (error) return { error: error.message }
        return {
          count: (data ?? []).length,
          messages: (data ?? []).reverse(),
        }
      },
    }),

    search_emails: tool({
      description:
        "Busca en el correo del VETERINARIO. Devuelve cada mensaje con dos referencias: `reply_ref` (para reply_email) y `thread_ref` (para read_email_thread). Úsala para encontrar un correo antes de responderlo, o para contestar '¿qué me escribió el laboratorio?'. Si no encontrás nada, probá con menos palabras o con la dirección de correo sola: en Outlook la búsqueda sólo mira remitente y asunto de los mensajes recientes, no el cuerpo.",
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .describe(
            "Texto a buscar. Una dirección de correo sola busca por remitente; con Gmail además funciona su sintaxis (from:, subject:, is:unread).",
          ),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      execute: async ({ query, limit }) => {
        if (!ctx.userId) {
          return { error: "El correo se lee con la cuenta del veterinario, y este turno no tiene una." }
        }
        const r = await buscarCorreos(ctx.userId, { query, limite: limit ?? 10 })
        // `needs_connection` NO es decorativo: la UI del chat lo usa para mostrar una tarjeta con
        // el botón de conectar, en vez de una línea de error que el vet no puede accionar.
        if (!r.ok) return r.sinConectar ? { error: r.error, needs_connection: CONEXION_CORREO } : { error: r.error }
        // Dos referencias y no una: en Outlook responder y leer el hilo usan ids DISTINTOS (el del
        // mensaje y el de la conversación). En Gmail son el mismo. El modelo no tiene que saber cuál
        // es cuál — solo devolver cada una donde corresponde.
        return {
          count: r.correos.length,
          messages: r.correos.map((c) => ({
            reply_ref: c.refRespuesta,
            thread_ref: c.refConversacion,
            de: c.de,
            para: c.para,
            asunto: c.asunto,
            preview: c.preview,
            fecha: c.fecha,
            leido: c.leido,
            es_propio: c.esPropio,
          })),
        }
      },
    }),

    read_email_thread: tool({
      description:
        "La conversación de correo completa. Úsala DESPUÉS de search_emails con el `thread_ref` que devolvió (NO el reply_ref: en Outlook son ids distintos) — responder sin leer el hilo produce respuestas que no encajan.",
      inputSchema: z.object({
        thread_id: z.string().describe("thread_ref que devolvió search_emails"),
      }),
      execute: async ({ thread_id }) => {
        if (!ctx.userId) {
          return { error: "El correo se lee con la cuenta del veterinario, y este turno no tiene una." }
        }
        const r = await leerConversacion(ctx.userId, thread_id)
        if (!r.ok) return r.sinConectar ? { error: r.error, needs_connection: CONEXION_CORREO } : { error: r.error }
        return { thread_id, count: r.correos.length, messages: r.correos }
      },
    }),

    search_consultations: tool({
      description:
        "Busca consultas presenciales pasadas (Phantom: grabadas y con nota clínica). Devuelve hasta 10 con id, fecha, paciente, motivo y estado. Úsala para '¿qué pasó con Lola la semana pasada?' o para encontrar el id antes de pedir detalles.",
      inputSchema: z.object({
        patient_id: z.string().uuid().optional().describe("Acotar a un paciente"),
        query: z.string().optional().describe("Texto a buscar en el motivo de consulta"),
      }),
      execute: async ({ patient_id, query }) => {
        let q = supabase
          .from("consultations")
          .select("id, status, chief_complaint, started_at, patient:patients(name)")
          .order("started_at", { ascending: false })
          .limit(10)
        if (patient_id) q = q.eq("patient_id", patient_id)
        if (query) q = q.ilike("chief_complaint", `%${escapeLike(query)}%`)
        const { data, error } = await q
        if (error) return { error: error.message }
        return { count: (data ?? []).length, consultations: data ?? [] }
      },
    }),

    get_consultation_details: tool({
      description:
        "Contenido completo de una consulta pasada: nota clínica SOAP (aprobada o borrador), transcripción (truncada en consultas largas) y motivo. Cítalo como fuente — es lo que efectivamente pasó.",
      inputSchema: z.object({ consultation_id: z.string().uuid() }),
      execute: async ({ consultation_id }) => {
        const [cons, note, transcript] = await Promise.all([
          supabase
            .from("consultations")
            .select("id, status, chief_complaint, started_at, ended_at, patient:patients(name), owner:owners(full_name)")
            .eq("id", consultation_id)
            .maybeSingle(),
          supabase
            .from("clinical_notes")
            .select("status, subjective, objective, assessment, plan")
            .eq("consultation_id", consultation_id)
            .order("created_at", { ascending: false })
            .limit(1),
          supabase
            .from("transcripts")
            .select("full_text")
            .eq("consultation_id", consultation_id)
            .order("created_at", { ascending: false })
            .limit(1),
        ])
        if (cons.error) return { error: cons.error.message }
        if (!cons.data) return { error: "No se encontró la consulta." }
        const fullText = (transcript.data as { full_text: string | null }[] | null)?.[0]?.full_text ?? null
        return {
          consultation: cons.data,
          clinical_note: (note.data as unknown[] | null)?.[0] ?? null,
          transcript_excerpt: fullText ? fullText.slice(0, 8000) : null,
          transcript_truncated: Boolean(fullText && fullText.length > 8000),
        }
      },
    }),

    search_clinical_evidence: tool({
      description:
        "Busca en la literatura veterinaria de Tuvetia (corpus con fuentes reales). Devuelve extractos con fuente y locator — cita SOLO esto. Guiate por evidence_level, NO por passed (que está saturado): 'sufficient' = respondé citando; 'limited' = respondé declarando que la literatura no cubre el cuadro; 'none' = abstenete, no cites nada.",
      inputSchema: z.object({
        question: z.string().min(3).describe("Pregunta clínica, en español"),
        species: z.string().optional().describe("Especie del paciente si se conoce (perro, gato…)"),
      }),
      execute: async ({ question, species }) => {
        const base = process.env.NEXT_PUBLIC_ATHOS_URL
        if (!base || !ctx.accessToken) return { error: "El servicio de literatura no está disponible ahora." }
        try {
          const res = await fetch(`${base.replace(/\/$/, "")}/athos/retrieve`, {
            method: "POST",
            headers: { Authorization: `Bearer ${ctx.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              clinic_id: ctx.clinicId,
              question,
              species: species ?? null,
              patient_id: ctx.patientId,
            }),
            signal: AbortSignal.timeout(20_000),
          })
          if (!res.ok) return { error: `Servicio de literatura respondió ${res.status}` }
          const body = (await res.json()) as Record<string, unknown>
          // El backend siempre manda evidence_level, pero durante una ventana de deploy desfasado
          // (front nuevo, athos-service viejo) podría faltar. Se normaliza para que el modelo nunca
          // se quede sin banda. Default 'sufficient' = falla ABIERTA, igual que el juez del backend:
          // ante un fallo de infraestructura no se le niega la literatura al vet.
          const band = typeof body.evidence_level === "string" ? body.evidence_level : "sufficient"
          return { ...body, evidence_level: band }
        } catch {
          return { error: "No se pudo consultar la literatura (timeout o red)." }
        }
      },
    }),

    // ── ESCRITURA (siempre PROPUESTA — el vet aprueba en la tarjeta) ─────────
    send_whatsapp_message: tool({
      description:
        "PROPONE enviar un WhatsApp a un titular (no lo envía: el vet aprueba/edita en la tarjeta). Texto estilo WhatsApp: corto, cálido, sin markdown. NUNCA contenido clínico (diagnósticos/dosis).",
      inputSchema: z.object({
        to_phone: z.string().min(6).describe("Teléfono del titular"),
        body: z.string().min(1).max(1500).describe("Texto del mensaje"),
        owner_id: z.string().uuid().nullable().optional(),
        in_reply_to: z.string().nullable().optional().describe("wa_message_id del entrante que responde, si aplica"),
      }),
      execute: async ({ to_phone, body, owner_id, in_reply_to }) =>
        proposeAction(
          ctx,
          "send_whatsapp_message",
          { to_phone: digits(to_phone), body, owner_id: owner_id ?? null, in_reply_to: in_reply_to ?? null },
          `Enviar WhatsApp a ${to_phone}: "${body.length > 120 ? `${body.slice(0, 119)}…` : body}"`,
          { ownerId: owner_id ?? null },
        ),
    }),

    send_email: tool({
      description:
        "PROPONE enviar un correo NUEVO a un titular (no lo envía: el vet aprueba/edita asunto y cuerpo en la tarjeta). Para responder algo que ya existe usa reply_email, que mantiene el hilo. Redacta en español, claro y breve, con saludo y despedida. NUNCA diagnósticos ni dosis.",
      inputSchema: z.object({
        to_email: z.string().email().describe("Correo del titular"),
        subject: z.string().min(1).max(200).describe("Asunto"),
        body: z.string().min(1).max(5000).describe("Cuerpo en texto plano"),
        owner_id: z.string().uuid().nullable().optional(),
      }),
      execute: async ({ to_email, subject, body, owner_id }) => {
        const falta = await faltaCorreoConectado(ctx.userId)
        if (falta) return falta
        return proposeAction(
          ctx,
          "send_email",
          { to_email: to_email.trim().toLowerCase(), subject, body, owner_id: owner_id ?? null },
          `Enviar correo a ${to_email}: "${subject}"`,
          { ownerId: owner_id ?? null },
        )
      },
    }),

    reply_email: tool({
      description:
        "PROPONE responder DENTRO de un hilo de correo existente (el vet aprueba/edita en la tarjeta). Lee el hilo con read_email_thread ANTES de redactar: de ahí sacás el destinatario y el asunto, que tenés que pasar vos. `to_email` debe ser una dirección que YA participa del hilo — al aprobar se verifica contra el hilo real y si no participa la respuesta no sale. Para escribirle a alguien nuevo usá send_email.",
      inputSchema: z.object({
        thread_id: z.string().describe("reply_ref que devolvió search_emails — identifica la conversación"),
        to_email: z.string().email().describe("A quién responde, tomado del hilo"),
        subject: z.string().min(1).max(200).describe("Asunto del hilo (con Re: si corresponde)"),
        body: z.string().min(1).max(5000).describe("Cuerpo de la respuesta, en texto plano"),
      }),
      execute: async ({ thread_id, to_email, subject, body }) => {
        const falta = await faltaCorreoConectado(ctx.userId)
        if (falta) return falta
        return proposeAction(
          ctx,
          "reply_email",
          { thread_id, to_email: to_email.trim().toLowerCase(), subject, body },
          `Responder el correo "${subject}"`,
          // La tarjeta se cuelga del HILO, no de la conversación donde se pidió: es en la bandeja
          // de correo donde el vet la va a buscar.
          { conversationKey: thread_id },
        )
      },
    }),

    create_appointment: tool({
      description:
        "PROPONE agendar una cita (el vet aprueba en la tarjeta). Paciente, titular y motivo son OBLIGATORIOS: consulta search_patients primero (ya devuelve owner_id, úsalo tal cual — no inventes un titular distinto). Consulta list_available_slots antes de elegir horario. date YYYY-MM-DD y time HH:mm en hora local.",
      inputSchema: z.object({
        title: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string().regex(/^\d{2}:\d{2}$/),
        duration_min: z.number().int().min(5).max(240).default(30),
        patient_id: z.string().uuid().describe("id del paciente, de search_patients"),
        owner_id: z.string().uuid().describe("owner_id del paciente elegido (viene en search_patients)"),
        reason: z.string().min(1).describe("motivo de la cita, obligatorio"),
        notes: z.string().nullable().optional(),
      }),
      execute: async ({ title, date, time, duration_min, patient_id, owner_id, reason, notes }) => {
        // Antes esto lanzaba RangeError con una fecha imposible y se caía el turno del agente.
        const slot = localRange(date, time, duration_min ?? 30)
        if (!slot) return invalidDateError(date, time)
        return proposeAction(
          ctx,
          "create_appointment",
          {
            title,
            starts_at: slot.from,
            ends_at: slot.to,
            patient_id,
            owner_id,
            reason,
            notes: notes ?? null,
          },
          `Agendar "${title}" el ${date} a las ${time} (${duration_min} min)`,
          { patientId: patient_id, ownerId: owner_id },
        )
      },
    }),

    update_appointment: tool({
      description:
        "PROPONE modificar o cancelar una cita existente (el vet aprueba). Encuentra el id con list_appointments_on_day primero. Solo pasa los campos a cambiar; para cancelar usa status='canceled'.",
      inputSchema: z.object({
        appointment_id: z.string().uuid(),
        title: z.string().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        duration_min: z.number().int().min(5).max(240).optional(),
        reason: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        status: z.enum(["scheduled", "confirmed", "completed", "canceled", "no_show"]).optional(),
        change_summary: z.string().min(3).describe("Resumen humano del cambio, ej. 'mover a mañana 10:00'"),
      }),
      execute: async ({ appointment_id, change_summary, ...changes }) =>
        proposeAction(ctx, "update_appointment", { appointment_id, ...changes }, `Cita: ${change_summary}`),
    }),

    create_owner: tool({
      description: "PROPONE crear un titular (dueño) nuevo. Si también hay mascota nueva, usa create_owner_and_patient.",
      inputSchema: z.object({
        full_name: z.string().min(2),
        phone: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        document_id: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
      execute: async (input) =>
        proposeAction(ctx, "create_owner", input, `Crear titular "${input.full_name}"${input.phone ? ` (${input.phone})` : ""}`),
    }),

    create_patient: tool({
      description:
        "PROPONE crear un paciente para un titular EXISTENTE (owner_id real de search_patients o get_owner_by_phone). Si el titular no existe, usa create_owner_and_patient.",
      inputSchema: z.object({
        owner_id: z.string().uuid(),
        name: z.string().min(1),
        species: z.string().min(1),
        sex: z.enum(["male", "female", "unknown"]).optional(),
        breed: z.string().nullable().optional(),
        birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        weight_kg: z.number().positive().max(999).nullable().optional(),
      }),
      execute: async (input) =>
        proposeAction(ctx, "create_patient", input, `Crear paciente "${input.name}" (${input.species})`, {
          ownerId: input.owner_id,
        }),
    }),

    create_owner_and_patient: tool({
      description:
        "PROPONE crear titular + paciente nuevos en una sola acción (el vet aprueba una vez). Mínimo: nombre del titular, nombre del paciente y especie — si falta info, pregunta antes.",
      inputSchema: z.object({
        owner: z.object({
          full_name: z.string().min(2),
          phone: z.string().nullable().optional(),
          email: z.string().nullable().optional(),
        }),
        patient: z.object({
          name: z.string().min(1),
          species: z.string().min(1),
          sex: z.enum(["male", "female", "unknown"]).optional(),
          breed: z.string().nullable().optional(),
          birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
          weight_kg: z.number().positive().max(999).nullable().optional(),
        }),
      }),
      execute: async (input) =>
        proposeAction(
          ctx,
          "create_owner_and_patient",
          input,
          `Crear titular "${input.owner.full_name}" + paciente "${input.patient.name}" (${input.patient.species})`,
        ),
    }),

    update_patient_record: tool({
      description:
        "PROPONE actualizar la ficha de un paciente: peso, nota que se AGREGA (no reemplaza) o alergia declarada. El vet aprueba en la tarjeta.",
      inputSchema: z.object({
        patient_id: z.string().uuid(),
        weight_kg: z.number().positive().max(999).optional(),
        notes_append: z.string().min(1).optional().describe("Texto a AGREGAR a las notas de la ficha"),
        add_allergy: z
          .object({
            allergen: z.string().min(1),
            severity: z.enum(["mild", "moderate", "severe"]),
            reaction: z.string().nullable().optional(),
          })
          .optional(),
        change_summary: z.string().min(3).describe("Resumen humano, ej. 'peso 4.5 kg + alergia a penicilina (severa)'"),
      }),
      execute: async ({ patient_id, change_summary, ...changes }) => {
        if (!changes.weight_kg && !changes.notes_append && !changes.add_allergy)
          return { error: "No hay ningún cambio para proponer." }
        return proposeAction(ctx, "update_patient_record", { patient_id, ...changes }, `Ficha: ${change_summary}`, {
          patientId: patient_id,
        })
      },
    }),
  }
}
