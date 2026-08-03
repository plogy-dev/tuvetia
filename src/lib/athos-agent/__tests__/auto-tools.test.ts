/**
 * Invariantes del modo AUTO de WhatsApp — la única superficie donde Athos habla solo, con un
 * titular, y SIN RLS (corre con service_role desde un webhook).
 *
 * Lo que se prueba acá no es comportamiento: es que la frontera de datos exista. Si alguno de estos
 * cae, un dueño de mascota puede ver o tocar lo de otro cliente de la misma clínica.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const inserted: Record<string, unknown>[] = []

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row)
        return {
          select: () => ({ single: async () => ({ data: { id: "act-1" }, error: null }) }),
        }
      },
    }),
  }),
}))

const { buildAutoReplyTools } = await import("../auto-tools")
const { calcularCupos } = await import("../agenda")

/**
 * Supabase falso que REGISTRA los filtros de cada consulta. Es el corazón de estos tests: sin RLS,
 * la única garantía de aislamiento es que el `.eq()` esté escrito, así que se afirma sobre eso.
 */
function crearAdmin(datos: Record<string, unknown[]>) {
  const consultas: { tabla: string; filtros: Record<string, unknown> }[] = []
  function from(tabla: string) {
    const filtros: Record<string, unknown> = {}
    consultas.push({ tabla, filtros })
    const filas = () => datos[tabla] ?? []
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filtros[col] = val
        return chain
      },
      neq: () => chain,
      gte: () => chain,
      lt: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
      // Las consultas sin `.limit()` ni `.maybeSingle()` se esperan directo: el builder de
      // supabase-js es un thenable y el falso tiene que serlo también.
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: filas(), error: null }).then(resolve),
    }
    return chain
  }
  return { admin: { from } as never, consultas }
}

const CTX = {
  clinicId: "clinic-A",
  ownerId: "owner-A",
  conversationKey: "573001112233",
  model: "modelo-de-prueba",
}

const PACIENTE = "00000000-0000-4000-8000-000000000001"

function manana(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
}

type Tool = { execute: (a: unknown) => Promise<Record<string, unknown>> }

/**
 * `buildAutoReplyTools` devuelve un tipo UNIÓN —con o sin las tools de titular— y eso es
 * deliberado: es lo que hace que el juego reducido sea visible en el tipo. El precio es que acá hay
 * que sacarlas por nombre.
 */
function tomar(tools: object, nombre: string): Tool {
  const t = (tools as Record<string, Tool | undefined>)[nombre]
  if (!t) throw new Error(`la tool ${nombre} no está en el juego`)
  return t
}

beforeEach(() => {
  inserted.length = 0
})

describe("aislamiento por clínica — no hay RLS que respalde", () => {
  it("los cupos se consultan SIEMPRE acotados a la clínica", async () => {
    const { admin, consultas } = crearAdmin({
      clinic_hours: [{ opens_at: "09:00:00", closes_at: "11:00:00", slot_minutes: 30 }],
      appointments: [],
    })
    const tools = buildAutoReplyTools(admin, CTX)
    await tomar(tools, "list_available_slots").execute({ date: manana() })

    // Las DOS tablas, no sólo una: olvidar el filtro en `appointments` haría que las citas de otra
    // clínica taparan cupos que sí están libres.
    expect(consultas.map((c) => c.tabla).sort()).toEqual(["appointments", "clinic_hours"])
    for (const c of consultas) expect(c.filtros.clinic_id, c.tabla).toBe("clinic-A")
  })

  it("las mascotas se filtran por clínica Y por titular", async () => {
    const { admin, consultas } = crearAdmin({ patients: [{ id: "pac-1", name: "Rocky" }] })
    const tools = buildAutoReplyTools(admin, CTX)
    await tomar(tools, "list_my_patients").execute({})
    expect(consultas[0].filtros.clinic_id).toBe("clinic-A")
    expect(consultas[0].filtros.owner_id).toBe("owner-A")
  })

  it("las citas se filtran por clínica Y por titular", async () => {
    const { admin, consultas } = crearAdmin({ appointments: [] })
    const tools = buildAutoReplyTools(admin, CTX)
    await tomar(tools, "list_my_appointments").execute({})
    expect(consultas[0].filtros.clinic_id).toBe("clinic-A")
    // Sin esto, preguntar "¿qué citas hay hoy?" devolvería los pacientes de OTROS clientes de la
    // misma clínica. Es la fuga que este archivo existe para impedir.
    expect(consultas[0].filtros.owner_id).toBe("owner-A")
  })
})

describe("un número desconocido no puede hacer nada", () => {
  it("sin titular reconocido, las tools de titular NI SIQUIERA EXISTEN", () => {
    const { admin } = crearAdmin({})
    const tools = buildAutoReplyTools(admin, { ...CTX, ownerId: null })
    // Más fuerte que devolver un error: el modelo no puede llamar lo que no está en su lista.
    expect(Object.keys(tools)).toEqual(["list_available_slots"])
  })
})

describe("propose_appointment", () => {
  it("rechaza una mascota que no es del titular, y NO deja propuesta", async () => {
    // El paciente no aparece: es de otro titular, así que el doble filtro no lo encuentra.
    const { admin } = crearAdmin({ patients: [] })
    const tools = buildAutoReplyTools(admin, CTX)
    const r = await tomar(tools, "propose_appointment").execute({
      patient_id: PACIENTE,
      date: manana(),
      time: "09:00",
      duration_min: 30,
      reason: "control",
    })
    expect(r.error).toMatch(/no está registrada a tu nombre/i)
    expect(inserted.length, "no debería haberse propuesto nada").toBe(0)
  })

  it("con una mascota propia deja una propuesta, no una cita", async () => {
    const { admin } = crearAdmin({ patients: [{ id: "pac-1", name: "Rocky" }] })
    const tools = buildAutoReplyTools(admin, CTX)
    const r = await tomar(tools, "propose_appointment").execute({
      patient_id: PACIENTE,
      date: manana(),
      time: "09:00",
      duration_min: 30,
      reason: "vacuna",
    })
    expect(r.status).toBe("proposed")
    expect(inserted).toHaveLength(1)
    const fila = inserted[0]
    expect(fila.source).toBe("auto")
    expect(fila.risk).toBe("approval") // pendiente de aprobación, no ejecutada
    expect(fila.owner_id).toBe("owner-A")
    expect(fila.clinic_id).toBe("clinic-A")
    // El MISMO nombre de tool que usa el chat del vet: así la tarjeta y el ejecutor no necesitan
    // saber que la propuesta llegó por WhatsApp.
    expect(fila.tool_name).toBe("create_appointment")

    // El anti-loop y el límite diario del modo auto cuentan `athos_actions` con status='executed'
    // (`whatsapp/auto-reply.ts`). Una propuesta nace sin ese estado, así que proponer una cita NO
    // consume la cuota de respuestas del titular. Si el freno dejara de filtrar por estado, esto
    // deja de ser cierto.
    expect(fila.status).toBeUndefined()
  })

  it("no acepta un horario que ya pasó", async () => {
    const { admin } = crearAdmin({ patients: [{ id: "pac-1", name: "Rocky" }] })
    const tools = buildAutoReplyTools(admin, CTX)
    const r = await tomar(tools, "propose_appointment").execute({
      patient_id: PACIENTE,
      date: "2020-01-01",
      time: "09:00",
      duration_min: 30,
      reason: "control",
    })
    expect(r.error).toBeDefined()
    expect(inserted.length).toBe(0)
  })

  it("una fecha que no existe no se rueda al día siguiente", async () => {
    const { admin } = crearAdmin({ patients: [{ id: "pac-1", name: "Rocky" }] })
    const tools = buildAutoReplyTools(admin, CTX)
    const r = await tomar(tools, "propose_appointment").execute({
      patient_id: PACIENTE,
      date: "2026-02-30",
      time: "09:00",
      duration_min: 30,
      reason: "control",
    })
    expect(r.error).toMatch(/inválida/i)
    expect(inserted.length).toBe(0)
  })
})

describe("calcularCupos", () => {
  const franjas = [{ opens_at: "09:00:00", closes_at: "11:00:00", slot_minutes: 30 }]

  it("trocea la franja en horas locales", () => {
    expect(calcularCupos({ date: "2026-08-10", franjas, ocupados: [] })).toEqual([
      "09:00",
      "09:30",
      "10:00",
      "10:30",
    ])
  })

  it("quita lo ocupado, y sólo lo que de verdad se solapa", () => {
    const cupos = calcularCupos({
      date: "2026-08-10",
      franjas,
      ocupados: [{ starts_at: "2026-08-10T09:30:00-05:00", ends_at: "2026-08-10T10:00:00-05:00" }],
    })
    expect(cupos).toEqual(["09:00", "10:00", "10:30"])
  })

  it("una cita que termina justo cuando empieza el cupo no lo bloquea", () => {
    // Solapamiento estricto: `fin > inicio`, no `>=`. Con `>=` la clínica perdía un cupo por cita.
    const cupos = calcularCupos({
      date: "2026-08-10",
      franjas,
      ocupados: [{ starts_at: "2026-08-10T08:30:00-05:00", ends_at: "2026-08-10T09:00:00-05:00" }],
    })
    expect(cupos[0]).toBe("09:00")
  })

  it("respeta la duración pedida por encima del slot de la clínica", () => {
    expect(calcularCupos({ date: "2026-08-10", franjas, ocupados: [], durationMin: 60 })).toEqual([
      "09:00",
      "10:00",
    ])
  })

  it("no devuelve nada si la duración no cabe en la franja", () => {
    expect(calcularCupos({ date: "2026-08-10", franjas, ocupados: [], durationMin: 180 })).toEqual(
      [],
    )
  })
})
