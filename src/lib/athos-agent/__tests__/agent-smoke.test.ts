/**
 * Agent smoke testing — invariantes de seguridad de la capa agéntica.
 *
 * Es el entregable del Milestone 2 que faltaba (§2.4 de la auditoría) y cubre el código de mayor
 * riesgo del sistema: el que escribe en la historia clínica y manda WhatsApp a clientes reales.
 * Antes de estos tests, `src/lib/athos-agent/` no tenía ni uno.
 *
 * Lo que se verifica acá son INVARIANTES, no comportamiento cosmético: si alguno cae, el diseño
 * "Athos propone / el veterinario aprueba" quedó roto y hay que detener el despliegue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

// El helper de propuesta usa el cliente de service_role: se intercepta para no tocar la red y para
// poder inspeccionar EXACTAMENTE qué fila se habría insertado.
const inserted: Record<string, unknown>[] = []
let insertError: { message: string } | null = null

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row)
        return {
          select: () => ({
            single: async () =>
              insertError ? { data: null, error: insertError } : { data: { id: "act-1" }, error: null },
          }),
        }
      },
    }),
  }),
}))

// Las tools de correo consultan Composio antes de proponer (para no hacer redactar un correo que
// después no se puede enviar). Se intercepta: `correoConectado` decide qué contesta.
let correoConectado = true
vi.mock("@/lib/composio/gmail", () => ({
  estadoConexion: async () => ({ conectado: correoConectado, email: "vet@ejemplo.com" }),
  ejecutarGmail: async () => ({ ok: true, data: {} }),
  GMAIL_TOOLS: { enviar: "GMAIL_SEND_EMAIL", buscar: "GMAIL_FETCH_EMAILS" },
}))

const { proposeAction } = await import("../actions")
const { buildAthosTools, localToIso } = await import("../tools")

const ctx = {
  userId: "vet-1",
  clinicId: "clinic-1",
  source: "chat" as const,
  conversationKey: "pac-1",
  patientId: "pac-1",
  accessToken: "jwt",
  model: "deepseek-v4-flash",
}

// Cliente de Supabase mínimo: las tools de lectura no se ejercitan acá (dependen de la RLS real,
// y las de correo van contra Composio), pero buildAthosTools lo necesita para construirse.
const fakeSupabase = {
  from: () => ({
    select: () => ({
      ilike: () => ({ limit: async () => ({ data: [], error: null }) }),
      eq: () => ({
        maybeSingle: async () => ({ data: { subject: "Consulta", owner_id: null }, error: null }),
      }),
    }),
  }),
} as never

beforeEach(() => {
  inserted.length = 0
  insertError = null
  correoConectado = true
})

describe("proposeAction — invariantes que sostienen la aprobación humana", () => {
  it("SIEMPRE marca risk='approval': no existe camino de auto-aprobación", async () => {
    await proposeAction(ctx, "create_appointment", { title: "control" }, "Agendar control")
    expect(inserted[0].risk).toBe("approval")
  })

  it("SIEMPRE nace en estado propuesto, nunca ejecutado", async () => {
    await proposeAction(ctx, "send_whatsapp_message", { body: "hola" }, "Responder")
    // `status` lo pone el default de la tabla ('proposed'): lo que importa es que el código NO lo
    // fuerce a otro valor.
    expect(inserted[0].status).toBeUndefined()
    expect(inserted[0].executed_at).toBeUndefined()
  })

  it("toma el clinic_id del CONTEXTO, no del payload — la clínica no es inyectable", async () => {
    await proposeAction(
      ctx,
      "create_patient",
      { name: "Luna", clinic_id: "clinic-DE-OTRO" },
      "Crear paciente",
    )
    expect(inserted[0].clinic_id).toBe("clinic-1")
  })

  it("registra quién la propuso, para la traza de auditoría", async () => {
    await proposeAction(ctx, "create_owner", { full_name: "Ana" }, "Crear titular")
    expect(inserted[0].created_by).toBe("vet-1")
    expect(inserted[0].proposed_by_model).toBe("deepseek-v4-flash")
  })

  it("en modo auto queda sin autor humano (created_by null), no atribuido a un vet", async () => {
    await proposeAction({ ...ctx, userId: null, source: "auto" }, "send_whatsapp_message", {}, "x")
    expect(inserted[0].created_by).toBeNull()
    expect(inserted[0].source).toBe("auto")
  })

  it("si el insert falla devuelve un error legible y NO finge que se propuso", async () => {
    insertError = { message: "permission denied" }
    const r = await proposeAction(ctx, "create_appointment", {}, "x")
    expect("error" in r).toBe(true)
    expect("action_id" in r).toBe(false)
  })

  it("el resultado le dice al modelo que la acción NO está ejecutada", async () => {
    const r = await proposeAction(ctx, "create_appointment", {}, "Agendar")
    if ("error" in r) throw new Error("no debería fallar")
    expect(r.status).toBe("proposed")
    expect(r.note.toLowerCase()).toContain("no está ejecutada")
  })
})

describe("inventario de tools — cobertura y separación lectura/escritura", () => {
  const tools = buildAthosTools(fakeSupabase, ctx)

  const LECTURA = [
    "search_patients",
    "get_patient_summary",
    "get_owner_by_phone",
    "list_appointments_on_day",
    "get_clinic_hours",
    "list_available_slots",
    "search_whatsapp_conversation",
    "search_emails",
    "read_email_thread",
    "search_consultations",
    "get_consultation_details",
    "search_clinical_evidence",
  ]
  const ESCRITURA = [
    "send_whatsapp_message",
    "send_email",
    "reply_email",
    "create_appointment",
    "update_appointment",
    "create_owner",
    "create_patient",
    "create_owner_and_patient",
    "update_patient_record",
  ]

  it("expone exactamente las 21 tools esperadas", () => {
    expect(Object.keys(tools).sort()).toEqual([...LECTURA, ...ESCRITURA].sort())
  })

  it("cada tool declara un inputSchema (el modelo no manda campos libres)", () => {
    for (const [nombre, t] of Object.entries(tools)) {
      expect((t as { inputSchema?: unknown }).inputSchema, nombre).toBeDefined()
    }
  })

  // Sin cuenta conectada, redactar el correo sería trabajo tirado: el vet lo aprueba y recién ahí
  // se entera de que no se puede enviar, habiendo perdido el texto. Se avisa ANTES de proponer.
  it("las tools de correo NO proponen si el vet no conectó su cuenta", async () => {
    correoConectado = false
    for (const nombre of ["send_email", "reply_email"] as const) {
      inserted.length = 0
      const t = tools[nombre] as unknown as { execute: (a: unknown) => Promise<unknown> }
      const r = (await t.execute({
        to_email: "ana@ejemplo.com",
        subject: "Control",
        body: "Hola",
        thread_id: "18f9c2a4b7e1d3f0",
      })) as Record<string, unknown>
      expect(inserted.length, `${nombre} no debería proponer sin cuenta`).toBe(0)
      // La marca que hace que el chat muestre la tarjeta de conectar en vez de una línea de error.
      expect(r.needs_connection, nombre).toBe("gmail")
    }
  })

  it("NINGUNA tool de escritura ejecuta: todas terminan en una propuesta", async () => {
    for (const nombre of ESCRITURA) {
      inserted.length = 0
      const t = tools[nombre as keyof typeof tools] as unknown as {
        execute: (args: unknown) => Promise<unknown>
      }
      // Argumentos mínimos válidos por tool; el objetivo es llegar a proposeAction.
      const args: Record<string, unknown> = {
        send_whatsapp_message: { to_phone: "3001234567", body: "hola colega" },
        send_email: { to_email: "ana@ejemplo.com", subject: "Control de Luna", body: "Hola Ana…" },
        reply_email: {
          thread_id: "18f9c2a4b7e1d3f0", // id de Gmail, no un uuid nuestro
          to_email: "ana@ejemplo.com",
          subject: "Re: Control de Luna",
          body: "Perfecto.",
        },
        create_appointment: { title: "Control", date: "2026-08-01", time: "10:00" },
        update_appointment: { appointment_id: "apt-1", change_summary: "mover" },
        create_owner: { full_name: "Ana Pérez" },
        create_patient: { owner_id: "own-1", name: "Luna", species: "perro" },
        create_owner_and_patient: {
          owner: { full_name: "Ana Pérez" },
          patient: { name: "Luna", species: "perro" },
        },
        update_patient_record: { patient_id: "pac-1", weight_kg: 12 },
      }[nombre]!
      const r = (await t.execute(args)) as Record<string, unknown>
      expect(inserted.length, `${nombre} debería proponer`).toBe(1)
      expect(inserted[0].risk, nombre).toBe("approval")
      expect(r.status ?? r.error, nombre).toBeDefined()
    }
  })
})

describe("localToIso — la hora local del vet no se corre de día", () => {
  it("fija el offset de Colombia, sin depender de la TZ del servidor", () => {
    // El servidor de Vercel corre en UTC: sin offset explícito, "10:00" se interpretaría como UTC
    // y la cita aparecería a las 5 a.m. locales.
    expect(localToIso("2026-08-01", "10:00")).toBe("2026-08-01T10:00:00-05:00")
    expect(new Date(localToIso("2026-08-01", "10:00")).toISOString()).toBe(
      "2026-08-01T15:00:00.000Z",
    )
  })

  it("una cita nocturna conserva su fecha local", () => {
    const iso = localToIso("2026-08-01", "23:30")
    expect(iso.startsWith("2026-08-01")).toBe(true)
  })
})

describe("fechas imposibles — el tool responde, no se cae", () => {
  // El inputSchema valida FORMATO con regex, no calendario: "2026-02-30" y "99:99" lo pasan.
  // Antes, esas fechas llegaban a `new Date(NaN).toISOString()` y lanzaban
  // `RangeError: Invalid time value`, tumbando el turno del agente sin mensaje útil para el vet.
  // Los modelos producen febrero 30 y mes 13 con más frecuencia de la que uno espera.
  const tools = buildAthosTools(fakeSupabase, ctx)
  // Los tres primeros SÍ son Invalid Date. Los dos últimos NO: JavaScript los rueda en silencio
  // (2026-02-30 -> 2026-03-02, y 2026 no es bisiesto así que 2026-02-29 -> 2026-03-01). Ese caso es
  // el peligroso de verdad: sin el round-trip la cita quedaba agendada otro día sin avisar.
  const IMPOSIBLES = ["2026-13-01", "2026-00-10", "2026-04-31", "2026-02-30", "2026-02-29"]

  function run(nombre: string, args: Record<string, unknown>) {
    const t = tools[nombre as keyof typeof tools] as unknown as {
      execute: (a: unknown) => Promise<unknown>
    }
    return t.execute(args) as Promise<Record<string, unknown>>
  }

  for (const date of IMPOSIBLES) {
    it(`create_appointment devuelve error legible con ${date} (no lanza)`, async () => {
      const r = await run("create_appointment", { title: "Control", date, time: "10:00", duration_min: 30 })
      expect(r.error, `${date} debería reportar error`).toContain("Fecha u hora inválida")
      expect(inserted.length, "no debe proponerse nada con fecha inválida").toBe(0)
    })
  }

  it("create_appointment tampoco se cae con una hora imposible", async () => {
    const r = await run("create_appointment", { title: "Control", date: "2026-08-01", time: "99:99" })
    expect(r.error).toContain("Fecha u hora inválida")
    expect(inserted.length).toBe(0)
  })

  it("create_appointment funciona sin duration_min (el default no viene si nadie aplica el schema)", async () => {
    const r = await run("create_appointment", { title: "Control", date: "2026-08-01", time: "10:00" })
    expect(r.error, "una fecha válida no debería dar error").toBeUndefined()
    expect(inserted.length).toBe(1)
    // 30 min por defecto: 10:00 -05:00 → 15:00Z, fin 15:30Z.
    expect((inserted[0].payload as { ends_at: string }).ends_at).toBe("2026-08-01T15:30:00.000Z")
  })

  it("las tools de LECTURA por día también responden en vez de lanzar", async () => {
    for (const nombre of ["list_appointments_on_day", "list_available_slots"]) {
      const r = await run(nombre, { date: "2026-02-30" })
      expect(r.error, `${nombre} debería reportar la fecha inválida`).toContain("Fecha u hora inválida")
    }
  })
})

describe("el rodaje silencioso de fechas — el caso que no era un crash", () => {
  const tools = buildAthosTools(fakeSupabase, ctx)

  it("JavaScript rueda 2026-02-30 a marzo sin quejarse (por eso hace falta el round-trip)", () => {
    // Fija el comportamiento del runtime que motiva la guarda. Si algún día Date empezara a
    // devolver Invalid Date acá, este test avisa que la guarda ya no es necesaria por este motivo.
    const t = new Date("2026-02-30T00:00:00-05:00").getTime()
    expect(Number.isFinite(t)).toBe(true)
    expect(new Date(t).toISOString()).toBe("2026-03-02T05:00:00.000Z")
  })

  it("una cita pedida para el 30 de febrero NO se agenda el 2 de marzo", async () => {
    const t = tools.create_appointment as unknown as { execute: (a: unknown) => Promise<Record<string, unknown>> }
    const r = await t.execute({ title: "Control", date: "2026-02-30", time: "09:00", duration_min: 30 })
    expect(r.error).toContain("Fecha u hora inválida")
    expect(inserted.length, "no debe proponerse una cita en una fecha corrida").toBe(0)
  })
})
