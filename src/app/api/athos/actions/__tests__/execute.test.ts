// La ruta que EJECUTA una acción aprobada por el veterinario.
//
// POR QUÉ ESTE ARCHIVO. Es la ruta más delicada del producto —manda WhatsApps y correos reales, crea
// citas, escribe en la historia clínica, hace la reserva atómica contra el doble clic y deja el
// rastro de auditoría— y hasta ahora no tenía UN SOLO test. Todo lo que la protege está escrito en
// comentarios: el compare-and-set, el descarte de campos desconocidos del override, el clasificador
// que impide filtrar la respuesta cruda del proveedor. Un comentario no falla cuando alguien lo
// rompe.
//
// Lo que se fija acá son invariantes, no detalles de implementación: que dos aprobaciones a la vez
// despachen UNA sola, que una propuesta inválida no quede reservada, que el detalle crudo no llegue
// nunca a la pantalla del vet, y que un fallo a medias diga qué quedó hecho.
//
// El validador de payload y el clasificador de fallos NO se mockean: son justamente lo que se prueba.

import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── Dobles ──────────────────────────────────────────────────────────────────────────────────────

const getUser = vi.fn()
const leerAccion = vi.fn()
const rpc = vi.fn()
const empujarCita = vi.fn()
const sendWhatsAppText = vi.fn()
const enviarCorreo = vi.fn()
const estadoConexion = vi.fn()

/** Todo lo que la ruta escribió con el cliente admin, en orden. Es el rastro que se inspecciona. */
let escrituras: { tabla: string; op: "update" | "insert"; datos: Record<string, unknown> }[] = []
/** Cuántas filas devuelve el UPDATE condicional de la reserva. 1 = esta request ganó. */
let filasReservadas = 1
/** Respuestas de las tablas que la ruta lee con la sesión del vet. */
let filaPaciente: { notes: string | null } | null = null
let filaCita: Record<string, unknown> | null = null
/** Error a devolver en el INSERT de `allergies` (para el fallo a medias de la ficha). */
let errorAlergia: { message: string } | null = null

/**
 * El constructor de queries de PostgREST es encadenable Y esperable a la vez: `update().eq()` se
 * puede await directo, o seguir con otro `.eq()`. Este doble hace las dos cosas.
 */
function encadenable(resultado: unknown) {
  const nodo: Record<string, unknown> = {}
  for (const m of ["eq", "select", "order", "limit"]) {
    nodo[m] = () => encadenable(resultado)
  }
  nodo.maybeSingle = async () => resultado
  nodo.single = async () => resultado
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(resultado).then(r)
  return nodo
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    rpc,
    from: (tabla: string) => {
      if (tabla === "athos_actions") {
        return { select: () => ({ eq: () => ({ maybeSingle: leerAccion }) }) }
      }
      if (tabla === "appointments") return encadenable({ data: filaCita, error: null })
      if (tabla === "patients") {
        return {
          select: () => encadenable({ data: filaPaciente, error: null }),
          update: () => encadenable({ data: null, error: null }),
        }
      }
      if (tabla === "allergies") {
        return { insert: async () => ({ error: errorAlergia }) }
      }
      return encadenable({ data: null, error: null })
    },
  }),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabla: string) => ({
      update: (datos: Record<string, unknown>) => {
        escrituras.push({ tabla, op: "update", datos })
        // `.select("id")` sólo lo llama la reserva; el resto se await directo tras el `.eq`.
        return encadenable({ data: Array.from({ length: filasReservadas }, () => ({ id: "a1" })) })
      },
      insert: async (datos: Record<string, unknown>) => {
        escrituras.push({ tabla, op: "insert", datos })
        return { error: null }
      },
    }),
  }),
}))

vi.mock("@/lib/composio/calendario", () => ({ empujarCita: (...a: unknown[]) => empujarCita(...a) }))
vi.mock("@/lib/whatsapp/send-message", () => ({
  sendWhatsAppText: (...a: unknown[]) => sendWhatsAppText(...a),
}))
vi.mock("@/lib/composio/correo", () => ({
  enviarCorreo: (...a: unknown[]) => enviarCorreo(...a),
  responderCorreo: async () => ({ ok: true }),
  verificarDestinatarioDeRespuesta: async () => ({ ok: true }),
  estadoConexion: (...a: unknown[]) => estadoConexion(...a),
  avisoDeEntrega: () => null,
}))

import { POST } from "@/app/api/athos/actions/[id]/execute/route"

// ─── Utilidades ──────────────────────────────────────────────────────────────────────────────────

const MANANA = () => new Date(Date.now() + 3600_000).toISOString()

const CITA_VALIDA = {
  title: "Control posquirúrgico",
  starts_at: "2026-08-20T10:30:00-05:00",
  ends_at: "2026-08-20T11:00:00-05:00",
  patient_id: "11111111-1111-4111-8111-111111111111",
  owner_id: "22222222-2222-4222-8222-222222222222",
  reason: "Retiro de puntos",
  notes: null,
}

function accion(over: Partial<Record<string, unknown>> = {}) {
  return {
    data: {
      id: "a1",
      clinic_id: "c1",
      status: "proposed",
      tool_name: "create_appointment",
      payload: CITA_VALIDA,
      owner_id: null,
      patient_id: null,
      expires_at: MANANA(),
      ...over,
    },
  }
}

const ejecutar = (body: unknown = {}) =>
  POST(
    new Request("https://x/api/athos/actions/a1/execute", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "a1" }) },
  )

/** El patch con el que se marcó la fila al terminar (la última escritura sobre `athos_actions`). */
function marcaFinal() {
  const ups = escrituras.filter((e) => e.tabla === "athos_actions" && e.op === "update")
  return ups[ups.length - 1]?.datos ?? {}
}

beforeEach(() => {
  vi.clearAllMocks()
  escrituras = []
  filasReservadas = 1
  filaPaciente = null
  filaCita = null
  errorAlergia = null
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } })
  leerAccion.mockResolvedValue(accion())
  rpc.mockResolvedValue({ data: "ap-1", error: null })
  empujarCita.mockResolvedValue({ eventId: "g-1", motivo: null })
  estadoConexion.mockResolvedValue({ proveedor: "gmail", email: "vet@clinica.com" })
})

// ─── Las guardas de antes de despachar ───────────────────────────────────────────────────────────

describe("no despacha nada si no corresponde", () => {
  it("sin sesión: 401", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect((await ejecutar()).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("la acción de otra clínica no existe (la RLS la esconde): 404", async () => {
    leerAccion.mockResolvedValue({ data: null })
    expect((await ejecutar()).status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("una propuesta ya ejecutada no se vuelve a ejecutar: 409", async () => {
    leerAccion.mockResolvedValue(accion({ status: "executed" }))
    expect((await ejecutar()).status).toBe(409)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("una propuesta vencida se marca expirada y no corre: 410", async () => {
    leerAccion.mockResolvedValue(accion({ expires_at: "2020-01-01T00:00:00Z" }))
    const res = await ejecutar()
    expect(res.status).toBe(410)
    expect(rpc).not.toHaveBeenCalled()
    expect(marcaFinal().status).toBe("expired")
  })

  it("un tool que no existe no llega a ninguna escritura real", async () => {
    leerAccion.mockResolvedValue(accion({ tool_name: "borrar_todo", payload: {} }))
    const res = await ejecutar()
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(rpc).not.toHaveBeenCalled()
  })
})

// ─── La reserva atómica: la guarda contra el doble envío ─────────────────────────────────────────

describe("reserva atómica", () => {
  it("si otra request ya se quedó con la acción, ésta NO despacha", async () => {
    // Es el doble clic en "Aprobar", o el reintento del navegador. Sin esta guarda salían dos citas
    // —o dos WhatsApps al titular— y las dos requests reportaban éxito.
    filasReservadas = 0
    const res = await ejecutar()
    expect(res.status).toBe(409)
    expect(rpc).not.toHaveBeenCalled()
    expect(empujarCita).not.toHaveBeenCalled()
  })

  it("la reserva ocurre ANTES de despachar, no después", async () => {
    await ejecutar()
    const iReserva = escrituras.findIndex((e) => e.datos.status === "approved")
    expect(iReserva).toBe(0) // lo primero que se escribe
    expect(rpc).toHaveBeenCalled()
  })
})

// ─── La revalidación del payload editado ─────────────────────────────────────────────────────────

describe("el payload que vuelve del navegador se vuelve a mirar", () => {
  it("el vet de la RPC sale de la SESIÓN, nunca del cuerpo de la petición", async () => {
    // Es lo que sostiene todo el modelo de permisos: las RPC son SECURITY DEFINER y ven el
    // `auth.uid()` real de quien aprueba. Si el `vet_id` pudiera venir del cuerpo, una acción se
    // podría atribuir a otra persona — y la firma de quién aprobó es media auditoría.
    //
    // El descarte de campos desconocidos NO se prueba acá: es una propiedad de `validarPayload` y
    // ya está cubierta en `payload-schemas.test.ts`. Afirmarla desde esta ruta daría un test que
    // pasa por otro motivo (cada `case` arma los argumentos de la RPC campo por campo, así que un
    // `clinic_id` inyectado tampoco llegaría sin validación) — o sea, un test que no cae cuando se
    // rompe lo que dice proteger. Se verificó por mutación.
    await ejecutar({ payload_override: { vet_id: "OTRO" } })
    const args = rpc.mock.calls[0][1] as Record<string, unknown>
    expect(args.p_vet_id).toBe("u1")
    expect(Object.values(args)).not.toContain("OTRO")
  })

  it("un override inválido se rechaza y la acción NO queda reservada", async () => {
    // Importante: si se reservara, la propuesta quedaría en `approved` sin haberse ejecutado nunca
    // — visible para el vet como "quedó a medio ejecutar" sin que nada hubiera pasado.
    const res = await ejecutar({ payload_override: { starts_at: "no-es-una-fecha" } })
    expect(res.status).toBe(400)
    expect(escrituras).toHaveLength(0)
    expect(rpc).not.toHaveBeenCalled()
  })
})

// ─── El camino feliz ─────────────────────────────────────────────────────────────────────────────

describe("ejecución exitosa", () => {
  it("marca la fila, guarda el resultado y deja auditoría", async () => {
    const res = await ejecutar()
    const body = (await res.json()) as { ok: boolean; result: Record<string, unknown> }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.result.appointment_id).toBe("ap-1")
    expect(marcaFinal().status).toBe("executed")
    expect(escrituras.some((e) => e.tabla === "audit_logs" && e.op === "insert")).toBe(true)
  })

  it("sin calendario conectado la cita SE CREA IGUAL, con aviso y sin id de Google", async () => {
    // La copia al calendario no bloquea: perder la cita sería mucho peor que perder la copia.
    empujarCita.mockResolvedValue({ eventId: null, motivo: "sin-conexion" })
    const res = await ejecutar()
    const body = (await res.json()) as { result: Record<string, unknown> }

    expect(res.status).toBe(200)
    expect(body.result.appointment_id).toBe("ap-1")
    expect(body.result.google_event_id).toBeNull()
    // El texto exacto cambió con v5 (el evento ya no vive sólo en el calendario del admin), así que
    // lo que se exige es lo que el vet necesita leer: que la cita está y que al calendario no llegó.
    expect(String(body.result.aviso)).toMatch(/no se copió a ningún calendario/i)
  })

  it("si el calendario explota, la cita tampoco se pierde", async () => {
    empujarCita.mockRejectedValue(new Error("Composio 500"))
    const res = await ejecutar()
    expect(res.status).toBe(200)
    expect(marcaFinal().status).toBe("executed")
  })
})

// ─── Los fallos ──────────────────────────────────────────────────────────────────────────────────

describe("cuando algo falla", () => {
  it("marca `failed`, guarda el error crudo y NO se lo muestra al vet", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'duplicate key en instancia tuvetia_6c7504ae con apikey=secreta' },
    })
    const res = await ejecutar()
    const body = (await res.json()) as { error: string }

    expect(marcaFinal().status).toBe("failed")
    expect(String(marcaFinal().error)).toContain("tuvetia_6c7504ae") // el rastro sí lo conserva
    expect(body.error).not.toContain("tuvetia_6c7504ae") // la pantalla no
    expect(body.error).not.toContain("secreta")
  })

  it("un fallo creando una cita NO le habla al vet de mensajes ni de WhatsApp", async () => {
    // El clasificador nació para los envíos; aplicado tal cual a las nueve tools, decía "no se pudo
    // enviar el mensaje" ante un fallo de Postgres y mandaba a revisar la conexión de WhatsApp.
    rpc.mockResolvedValue({ data: null, error: { message: "violación de constraint" } })
    const body = (await (await ejecutar()).json()) as { error: string }
    expect(body.error).not.toMatch(/mensaje|whatsapp/i)
  })

  it("un fallo ENVIANDO sí conserva el texto de envío", async () => {
    leerAccion.mockResolvedValue(
      accion({
        tool_name: "send_whatsapp_message",
        payload: { to_phone: "573001234567", body: "hola" },
      }),
    )
    sendWhatsAppText.mockRejectedValue(new Error("algo raro"))
    const body = (await (await ejecutar()).json()) as { error: string }
    expect(body.error).toMatch(/mensaje/i)
  })
})

// ─── Los fallos A MEDIAS: lo que quedó hecho ─────────────────────────────────────────────────────

describe("acciones que se completan por la mitad", () => {
  it("titular creado y paciente fallido: le dice al vet que NO reintente a ciegas", async () => {
    // Sin esto el vet leía "error inesperado", volvía a aprobar y terminaba con el titular duplicado.
    leerAccion.mockResolvedValue(
      accion({
        tool_name: "create_owner_and_patient",
        payload: { owner: { full_name: "Camila Ospina" }, patient: { name: "Luna", species: "canino" } },
      }),
    )
    rpc
      .mockResolvedValueOnce({ data: "o-1", error: null }) // el titular SÍ se crea
      .mockResolvedValueOnce({ data: null, error: { message: "patients_pkey duplicado" } })

    const body = (await (await ejecutar()).json()) as { error: string }

    expect(body.error).toMatch(/titular se creó/i)
    expect(body.error).toMatch(/duplicado/i) // dice qué pasa si reintenta
    expect(body.error).not.toContain("patients_pkey") // sin filtrar el detalle de Postgres
    expect(String(marcaFinal().error)).toContain("patients_pkey") // que sí queda en el rastro
  })

  it("ficha actualizada y alergia fallida: avisa que el aviso de alergia NO va a aparecer", async () => {
    // El peor de los dos: creer que la alergia quedó registrada es lo que desarma el gate de
    // alergia severa en la consulta siguiente.
    leerAccion.mockResolvedValue(
      accion({
        tool_name: "update_patient_record",
        payload: {
          patient_id: "11111111-1111-4111-8111-111111111111",
          weight_kg: 4.5,
          add_allergy: { allergen: "penicilina", severity: "severe" },
        },
      }),
    )
    errorAlergia = { message: "allergies_clinic_fk violado" }

    const body = (await (await ejecutar()).json()) as { error: string }

    expect(body.error).toMatch(/alergia/i)
    expect(body.error).toMatch(/a mano|cargala/i) // dice qué hacer ahora
    expect(body.error).not.toContain("allergies_clinic_fk")
    expect(marcaFinal().status).toBe("failed")
  })
})
