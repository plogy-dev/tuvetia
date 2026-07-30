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

// Cliente de Supabase mínimo: las tools de lectura no se ejercitan acá (dependen de la RLS real),
// pero buildAthosTools lo necesita para construirse.
const fakeSupabase = {
  from: () => ({
    select: () => ({
      ilike: () => ({ limit: async () => ({ data: [], error: null }) }),
      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
    }),
  }),
} as never

beforeEach(() => {
  inserted.length = 0
  insertError = null
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
    "search_consultations",
    "get_consultation_details",
    "search_clinical_evidence",
  ]
  const ESCRITURA = [
    "send_whatsapp_message",
    "create_appointment",
    "update_appointment",
    "create_owner",
    "create_patient",
    "create_owner_and_patient",
    "update_patient_record",
  ]

  it("expone exactamente las 17 tools esperadas", () => {
    expect(Object.keys(tools).sort()).toEqual([...LECTURA, ...ESCRITURA].sort())
  })

  it("cada tool declara un inputSchema (el modelo no manda campos libres)", () => {
    for (const [nombre, t] of Object.entries(tools)) {
      expect((t as { inputSchema?: unknown }).inputSchema, nombre).toBeDefined()
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
