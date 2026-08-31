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
      // `is` se registra igual que `eq`: desde la 0069 el filtro que separa el horario de la
      // clínica del de una persona es `.is("vet_id", null)`, y si no se registra no se puede
      // afirmar sobre él — que es todo lo que este archivo hace.
      is: (col: string, val: unknown) => {
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
      //
      // `count` viaja SIEMPRE, aunque la consulta no lo haya pedido. PostgREST sólo lo devuelve con
      // `{ count: "exact" }`, pero devolverlo de más acá no engaña a nadie y sí evita el modo de
      // fallo que este doble tuvo hasta el 31-ago: sin `count`, toda consulta de conteo leía
      // `undefined`, o sea "cero filas", y las pruebas pasaban por el motivo equivocado.
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: filas(), error: null, count: filas().length }).then(resolve),
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

describe("los dos ceros que no son el mismo cero", () => {
  /**
   * El silencio del 30-ago, en una prueba.
   *
   * `Clinica de Santiago Tellez` tenía `clinic_hours` VACÍO. Un titular pidió cita, dijo «Mañana», y
   * la herramienta devolvió «La clínica no atiende ese día» — una frase FALSA, porque con cero
   * horarios se devolvía todos los días del año. El modelo no puede repetir algo falso, no puede
   * inventar horas (regla dura del prompt) y ante la duda se calla: el titular quedó sin respuesta,
   * y los tres mensajes que mandó después chocaron con lo mismo.
   *
   * Lo que se fija acá no es el texto sino la DISTINCIÓN: sin horarios y cerrado ese día tienen que
   * ser dos respuestas distintas, porque llevan al agente a hacer dos cosas distintas.
   */
  it("sin NINGÚN horario cargado, lo dice y manda a tomar el pedido igual", async () => {
    const { admin } = crearAdmin({ clinic_hours: [], appointments: [] })
    const tools = buildAutoReplyTools(admin, CTX)

    const r = await tomar(tools, "list_available_slots").execute({ date: manana() })

    expect(r.configured).toBe(false)
    expect(r.motivo).toBe("sin_horarios_configurados")
    // La nota tiene que DECIRLE QUÉ HACER, no sólo informar el problema: un modelo al que se le
    // describe un obstáculo sin salida vuelve al comodín de la casa, que es el silencio.
    expect(r.note).toMatch(/sin_hora/)
    expect(r.note).toMatch(/no te calles/i)
  })

  it("con horarios en otros días pero no en éste, ofrece otro día", async () => {
    // El doble devuelve las mismas filas para toda consulta a `clinic_hours`, así que este caso se
    // arma al revés que el de arriba: hay filas, luego hay horarios cargados. Lo que se comprueba
    // es que ese cero NO se confunda con el otro.
    const { admin } = crearAdmin({
      clinic_hours: [{ opens_at: "09:00:00", closes_at: "11:00:00", slot_minutes: 30 }],
      appointments: [],
    })
    const tools = buildAutoReplyTools(admin, CTX)

    const r = await tomar(tools, "list_available_slots").execute({ date: manana() })

    expect(r.motivo).not.toBe("sin_horarios_configurados")
  })
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
    //
    // `clinic_hours` aparece DOS veces desde el 31-ago y no es un descuido: una consulta trae las
    // franjas del día pedido y la otra cuenta si la clínica tiene horarios en ALGÚN día. Sin esa
    // segunda, «no hay franjas» se confundía con «la clínica no atiende ese día» y el agente se
    // quedaba mudo — el silencio del 30-ago. La que importa acá es la línea de abajo: las tres van
    // acotadas a la clínica.
    expect(consultas.map((c) => c.tabla).sort()).toEqual([
      "appointments",
      "clinic_hours",
      "clinic_hours",
    ])
    for (const c of consultas) expect(c.filtros.clinic_id, c.tabla).toBe("clinic-A")
  })

  it("los cupos que se le ofrecen a un titular salen del horario de la CLÍNICA", async () => {
    // Migración 0069. Del otro lado de esta herramienta hay un titular por WhatsApp, que no elige
    // veterinario: sin el filtro, el horario personal de quien sea se mezclaría con el de la
    // puerta y la clínica pasaría a "abrir" a las 2 porque ese día ese vet entra a las 2.
    const { admin, consultas } = crearAdmin({
      clinic_hours: [{ opens_at: "09:00:00", closes_at: "11:00:00", slot_minutes: 30 }],
      appointments: [],
    })
    const tools = buildAutoReplyTools(admin, CTX)
    await tomar(tools, "list_available_slots").execute({ date: manana() })

    const horarios = consultas.find((c) => c.tabla === "clinic_hours")
    expect(horarios!.filtros).toHaveProperty("vet_id")
    expect(horarios!.filtros.vet_id).toBeNull()
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

describe("un número desconocido no accede a datos de nadie", () => {
  it("las tools de TITULAR ni siquiera existen", () => {
    const { admin } = crearAdmin({})
    const tools = buildAutoReplyTools(admin, { ...CTX, ownerId: null })
    // Más fuerte que devolver un error: el modelo no puede llamar lo que no está en su lista.
    //
    // OJO CON LO QUE ESTE TEST FIJA. Antes exigía que la lista fuera EXACTAMENTE
    // `["list_available_slots"]`, y eso mezclaba dos cosas: que no vea datos ajenos (que sigue
    // valiendo) con que no pueda pedir cita (que se revirtió a propósito el 26-ago — el cliente
    // nuevo era el único al que la clínica respondía a mano). Lo que se fija ahora es lo primero.
    expect(Object.keys(tools).sort()).toEqual(["list_available_slots", "solicitar_cita"])
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

// ── Un número NO registrado también puede pedir cita ────────────────────────────────────────────
//
// Antes no podía: `if (!ownerId) return publicas` le dejaba sólo los horarios, así que el cliente
// nuevo —el que más cuesta conseguir— era el único al que la clínica le respondía a mano.
//
// Lo que se fija acá son las dos mitades del acuerdo: que PUEDA pedir, y que lo que pida NO entre
// solo a la base.

describe("un número que no está registrado", () => {
  const SIN_TITULAR = { ...CTX, ownerId: null }

  it("puede consultar cupos y pedir cita", () => {
    const { admin } = crearAdmin({ clinic_hours: [], appointments: [] })
    const tools = buildAutoReplyTools(admin, SIN_TITULAR)
    expect(tools).toHaveProperty("list_available_slots")
    expect(tools).toHaveProperty("solicitar_cita")
  })

  it("NO puede ver mascotas ni citas de nadie", () => {
    // Un teléfono no verifica a nadie: enumerar mascotas o citas sería entregar información de otra
    // persona a quien sepa un número.
    const { admin } = crearAdmin({ clinic_hours: [], appointments: [] })
    const tools = buildAutoReplyTools(admin, SIN_TITULAR)
    expect(tools).not.toHaveProperty("list_my_patients")
    expect(tools).not.toHaveProperty("list_my_appointments")
    expect(tools).not.toHaveProperty("propose_appointment")
  })

  it("un titular reconocido NO recibe la herramienta de solicitud", () => {
    // Tiene `propose_appointment`, que ata la cita a su paciente real. Dejarle las dos permitiría
    // crear un titular duplicado de alguien que ya está en la base.
    const { admin } = crearAdmin({ clinic_hours: [], appointments: [] })
    const tools = buildAutoReplyTools(admin, CTX)
    expect(tools).not.toHaveProperty("solicitar_cita")
    expect(tools).toHaveProperty("propose_appointment")
  })
})
