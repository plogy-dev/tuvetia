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
import { ejecutarGmail, GMAIL_TOOLS } from "@/lib/composio/gmail"

type SB = SupabaseClient

const TZ_OFFSET = "-05:00"
// Mismo offset en minutos, para aritmética. Colombia no tiene horario de verano, así que es fijo:
// si algún día se soportara otra zona, estos dos tienen que moverse juntos.
const TZ_OFFSET_MINUTES = -300

export function localToIso(date: string, time: string): string {
  return `${date}T${time}:00${TZ_OFFSET}`
}

/**
 * Rango [from, to) en ISO a partir de fecha + hora LOCAL del vet. Devuelve null si el instante no
 * existe.
 *
 * Por qué la guarda: el regex del inputSchema valida FORMATO, no calendario. `2026-02-30` y `99:99`
 * pasan `/^\d{4}-\d{2}-\d{2}$/` y `/^\d{2}:\d{2}$/` sin problema, y revientan en `new Date()` como
 * Invalid Date. Los modelos producen ese tipo de fecha con más frecuencia de la que uno espera
 * (febrero 30, mes 13). La versión anterior hacía `new Date(NaN).toISOString()` y lanzaba
 * `RangeError: Invalid time value`: el turno del agente se caía entero, sin mensaje útil para el vet.
 * Ahora el tool devuelve un error legible y el modelo puede corregir la fecha y reintentar.
 *
 * `minutes` no finito se trata como 0 en vez de propagar NaN: el schema tiene default, pero el tool
 * no debería depender de que alguien lo haya aplicado.
 */
function localRange(
  date: string,
  time: string,
  minutes: number,
): { from: string; to: string } | null {
  const from = localToIso(date, time)
  const fromMs = new Date(from).getTime()
  if (!Number.isFinite(fromMs)) return null // mes 13, hora 99:99…

  // ROUND-TRIP, y es lo que de verdad importa: `2026-02-30` NO es Invalid Date. JavaScript la
  // RUEDA en silencio a 2026-03-02, igual que `2026-02-29` (2026 no es bisiesto) → 2026-03-01.
  // Sin esta comprobación la cita se agendaba OTRO DÍA sin que nadie se enterara — corrupción
  // silenciosa, peor que un error. Se reconstruye la fecha local y se exige que sea la pedida.
  const localMs = fromMs + TZ_OFFSET_MINUTES * 60_000
  const back = new Date(localMs)
  const ymd = `${back.getUTCFullYear()}-${String(back.getUTCMonth() + 1).padStart(2, "0")}-${String(back.getUTCDate()).padStart(2, "0")}`
  if (ymd !== date) return null

  const mins = Number.isFinite(minutes) ? minutes : 0
  return { from, to: new Date(fromMs + mins * 60_000).toISOString() }
}

/** Mensaje único para el modelo cuando la fecha no existe (no se repite el texto en cada tool). */
function invalidDateError(date: string, time?: string) {
  return {
    error: `Fecha u hora inválida: ${date}${time ? ` ${time}` : ""}. Verificá que el día exista en el calendario (por ejemplo, febrero no tiene 30) y reintentá.`,
  }
}

const digits = (s: string) => s.replace(/\D/g, "")

function escapeLike(q: string): string {
  return q.trim().replace(/[%_\\]/g, "\\$&")
}

// ─── Tools ───────────────────────────────────────────────────────────────────

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

    get_patient_summary: tool({
      description:
        "Resumen clínico de un paciente: ficha (especie, raza, sexo, nacimiento, peso), ALERGIAS (las severas son bloqueantes para cualquier plan) y medicación activa.",
      inputSchema: z.object({ patient_id: z.string().uuid() }),
      execute: async ({ patient_id }) => {
        const [patient, allergies, meds] = await Promise.all([
          supabase
            .from("patients")
            .select("id, name, species, breed, sex, birth_date, weight_kg, owner:owners(id, full_name, phone, email)")
            .eq("id", patient_id)
            .maybeSingle(),
          supabase.from("allergies").select("allergen, severity, reaction").eq("patient_id", patient_id),
          supabase
            .from("medications")
            .select("drug_name, dose, frequency, is_chronic, end_date")
            .eq("patient_id", patient_id)
            .or(`end_date.is.null,end_date.gte.${new Date().toISOString().slice(0, 10)}`),
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

    get_clinic_hours: tool({
      description:
        "Horarios de atención de la clínica por día de semana (0=domingo … 6=sábado). Si está vacío, la clínica no los configuró — dile al vet que los cargue en Configuración.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("clinic_hours")
          .select("weekday, opens_at, closes_at, slot_minutes")
          .order("weekday")
          .order("opens_at")
        if (error) return { error: error.message }
        return { configured: (data ?? []).length > 0, hours: data ?? [] }
      },
    }),

    list_available_slots: tool({
      description:
        "Cupos DISPONIBLES para citas en un día: horarios de la clínica menos citas existentes. Úsala SIEMPRE antes de proponer una cita — nunca inventes disponibilidad.",
      inputSchema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        duration_min: z.number().int().min(5).max(240).optional().describe("Duración deseada (default: slot de la clínica)"),
      }),
      execute: async ({ date, duration_min }) => {
        const day = localRange(date, "00:00", 24 * 60)
        // Sin la guarda, un `2026-02-30` daba weekday=NaN y una consulta con rango inválido:
        // el vet recibía "no hay horarios" en vez de saber que la fecha no existe.
        if (!day) return invalidDateError(date)
        const weekday = new Date(`${date}T12:00:00${TZ_OFFSET}`).getUTCDay()
        const [{ data: hours, error: hErr }, apptsRes] = await Promise.all([
          supabase
            .from("clinic_hours")
            .select("opens_at, closes_at, slot_minutes")
            .eq("weekday", weekday)
            .order("opens_at"),
          supabase
            .from("appointments")
            .select("starts_at, ends_at, status")
            .gte("starts_at", day.from)
            .lt("starts_at", day.to)
            .neq("status", "canceled"),
        ])
        if (hErr) return { error: hErr.message }
        if (!hours?.length)
          return {
            configured: false,
            slots: [],
            note: "La clínica no tiene horario configurado para ese día (o no cargó sus horarios en Configuración).",
          }
        const appts = ((apptsRes.data ?? []) as { starts_at: string; ends_at: string }[]).map((a) => ({
          from: new Date(a.starts_at).getTime(),
          to: new Date(a.ends_at).getTime(),
        }))
        const slots: string[] = []
        for (const h of hours as { opens_at: string; closes_at: string; slot_minutes: number }[]) {
          const step = duration_min ?? h.slot_minutes
          let cursor = new Date(`${date}T${h.opens_at.slice(0, 5)}:00${TZ_OFFSET}`).getTime()
          const close = new Date(`${date}T${h.closes_at.slice(0, 5)}:00${TZ_OFFSET}`).getTime()
          while (cursor + step * 60_000 <= close) {
            const end = cursor + step * 60_000
            const busy = appts.some((a) => cursor < a.to && end > a.from)
            if (!busy) {
              const d = new Date(cursor - 5 * 3600_000) // a hora local Colombia
              slots.push(`${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`)
            }
            cursor = end
          }
        }
        return { configured: true, date, slots: slots.slice(0, 40) }
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
        "Busca en el correo del VETERINARIO por texto (usa la sintaxis de búsqueda de Gmail: 'from:ana@…', 'subject:factura', o texto suelto). Devuelve los mensajes con su id de hilo. Úsala para encontrar un correo antes de responderlo, o para contestar '¿qué me escribió el laboratorio?'.",
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .describe("Búsqueda estilo Gmail: texto, from:correo, subject:asunto, is:unread…"),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      execute: async ({ query, limit }) => {
        if (!ctx.userId) {
          return { error: "El correo se lee con la cuenta del veterinario, y este turno no tiene una." }
        }
        const r = await ejecutarGmail(ctx.userId, GMAIL_TOOLS.buscar, {
          query,
          max_results: limit ?? 10,
        })
        if (!r.ok) return { error: r.error }
        return { messages: r.data }
      },
    }),

    read_email_thread: tool({
      description:
        "El hilo de correo completo, en orden. Úsala DESPUÉS de search_emails con el thread_id que devolvió — responder sin leer el hilo produce respuestas que no encajan.",
      inputSchema: z.object({
        thread_id: z.string().describe("id del hilo de Gmail, de search_emails"),
        limit: z.number().int().min(1).max(30).optional(),
      }),
      execute: async ({ thread_id, limit }) => {
        if (!ctx.userId) {
          return { error: "El correo se lee con la cuenta del veterinario, y este turno no tiene una." }
        }
        // Gmail no tiene "traer hilo" como tool separada: se busca por su id, que es lo que la
        // sintaxis `thread:` hace nativamente.
        const r = await ejecutarGmail(ctx.userId, GMAIL_TOOLS.buscar, {
          query: `thread:${thread_id}`,
          max_results: limit ?? 20,
        })
        if (!r.ok) return { error: r.error }
        return { thread_id, messages: r.data }
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
      execute: async ({ to_email, subject, body, owner_id }) =>
        proposeAction(
          ctx,
          "send_email",
          { to_email: to_email.trim().toLowerCase(), subject, body, owner_id: owner_id ?? null },
          `Enviar correo a ${to_email}: "${subject}"`,
          { ownerId: owner_id ?? null },
        ),
    }),

    reply_email: tool({
      description:
        "PROPONE responder DENTRO de un hilo de correo existente (el vet aprueba/edita en la tarjeta). Lee el hilo con read_email_thread ANTES de redactar: de ahí sacás el destinatario y el asunto, que tenés que pasar vos. `to_email` debe ser una dirección que YA participa del hilo — al aprobar se verifica contra Gmail y si no participa la respuesta no sale. Para escribirle a alguien nuevo usá send_email.",
      inputSchema: z.object({
        thread_id: z.string().describe("id del hilo de Gmail, de search_emails o read_email_thread"),
        to_email: z.string().email().describe("A quién responde, tomado del hilo"),
        subject: z.string().min(1).max(200).describe("Asunto del hilo (con Re: si corresponde)"),
        body: z.string().min(1).max(5000).describe("Cuerpo de la respuesta, en texto plano"),
      }),
      execute: async ({ thread_id, to_email, subject, body }) =>
        proposeAction(
          ctx,
          "reply_email",
          { thread_id, to_email: to_email.trim().toLowerCase(), subject, body },
          `Responder el correo "${subject}"`,
          // La tarjeta se cuelga del HILO, no de la conversación donde se pidió: es en la bandeja
          // de correo donde el vet la va a buscar.
          { conversationKey: thread_id },
        ),
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
