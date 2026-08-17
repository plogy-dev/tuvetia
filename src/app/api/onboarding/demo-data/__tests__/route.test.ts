// La siembra de los datos de ejemplo.
//
// LO QUE SE PRUEBA ACÁ ES QUE UNA SIEMBRA A MEDIAS NO SOBREVIVA. Son cinco inserts sin transacción:
// si el cuarto falla, los tres primeros ya están escritos. Y como la guarda de idempotencia pregunta
// sólo por el TITULAR, el reintento lo encuentra y responde `{ ok: true, already: true }` — o sea que
// el demo queda roto para siempre y encima reportando éxito. Un fallo que se presenta como acierto es
// el peor de todos: nadie lo va a buscar.
//
// La invariante que estos tests defienden es una sola: **si el titular demo existe, el demo está
// completo.** Todo lo demás de este archivo es esa frase, comprobada.

import { beforeEach, describe, expect, it, vi } from "vitest"

/** Respuesta por `tabla:operacion`. Sin entrada = éxito con datos genéricos. */
let respuestas: Record<string, { data?: unknown; error?: { message: string } | null }> = {}
/** Lo que se insertó, en orden. */
let insertados: string[] = []
/** Los DELETE que se ejecutaron, con sus filtros — es lo que prueba la limpieza. */
let borrados: { tabla: string; filtros: Record<string, unknown> }[] = []

function respuesta(tabla: string, op: string) {
  const propia = respuestas[`${tabla}:${op}`]
  if (propia) return { data: propia.data ?? null, error: propia.error ?? null }
  // Por defecto todo sale bien y devuelve un id, que es lo que la ruta encadena.
  return { data: { id: `${tabla}-id` }, error: null }
}

function clienteFalso() {
  return {
    from(tabla: string) {
      const filtros: Record<string, unknown> = {}
      let op = "select"
      const nodo: Record<string, unknown> = {
        select: () => nodo,
        insert: () => {
          op = "insert"
          insertados.push(tabla)
          return nodo
        },
        delete: () => {
          op = "delete"
          return nodo
        },
        eq: (columna: string, valor: unknown) => {
          filtros[columna] = valor
          return nodo
        },
        maybeSingle: async () => respuesta(tabla, "select"),
        single: async () => respuesta(tabla, op),
        then: (resolver: (v: unknown) => unknown) => {
          if (op === "delete") borrados.push({ tabla, filtros })
          return resolver(respuesta(tabla, op))
        },
      }
      return nodo
    },
  }
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => clienteFalso() }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "vet-1" } } }) },
  }),
}))

import { POST } from "@/app/api/onboarding/demo-data/route"

const CLINICA = "cli-1"

beforeEach(() => {
  insertados = []
  borrados = []
  vi.spyOn(console, "error").mockImplementation(() => {})
  respuestas = {
    // El perfil resuelve la clínica y está activo.
    "profiles:select": { data: { clinic_id: CLINICA, is_active: true } },
    // No hay demo previo.
    "owners:select": { data: null },
  }
})

describe("cuando la siembra sale bien", () => {
  it("escribe las cinco filas y no borra nada", async () => {
    const res = await POST()

    expect(res.status).toBe(200)
    expect(insertados).toEqual(["owners", "patients", "consultations", "transcripts", "clinical_notes"])
    expect(borrados).toEqual([])
  })
})

describe("cuando la siembra falla a mitad de camino", () => {
  // EL CASO QUE MOTIVA EL ARREGLO. Sin la limpieza, el titular queda escrito y el reintento lo da
  // por un demo completo.
  it("si falla el transcript, el titular sembrado se deshace", async () => {
    respuestas["transcripts:insert"] = { error: { message: "timeout" } }

    const res = await POST()

    expect(res.status).toBe(500)
    expect(borrados).toHaveLength(1)
    expect(borrados[0].tabla).toBe("owners")
    expect(borrados[0].filtros.id).toBe("owners-id")
  })

  it("también si falla la nota, que es el último paso", async () => {
    respuestas["clinical_notes:insert"] = { error: { message: "constraint" } }

    await POST()

    expect(borrados.map((b) => b.tabla)).toEqual(["owners"])
  })

  it("y si falla el paciente, apenas después del titular", async () => {
    respuestas["patients:insert"] = { error: { message: "boom" } }

    await POST()

    expect(borrados.map((b) => b.tabla)).toEqual(["owners"])
  })

  // La ruta usa `service_role`, que se salta la RLS. La regla de la casa es que toda consulta con esa
  // credencial lleve su `clinic_id` explícito — un DELETE sin él es un borrado sin dueño.
  it("la limpieza filtra por clínica además de por id", async () => {
    respuestas["transcripts:insert"] = { error: { message: "timeout" } }

    await POST()

    expect(borrados[0].filtros.clinic_id).toBe(CLINICA)
  })

  // Si el titular ni siquiera llegó a crearse, no hay nada que deshacer.
  it("si falla el propio titular, no intenta borrar nada", async () => {
    respuestas["owners:insert"] = { error: { message: "no se pudo" } }

    const res = await POST()

    expect(res.status).toBe(500)
    expect(borrados).toEqual([])
  })
})

describe("las guardas que ya existían siguen en pie", () => {
  it("sin clínica no siembra", async () => {
    respuestas["profiles:select"] = { data: { clinic_id: null, is_active: true } }

    const res = await POST()

    expect(res.status).toBe(400)
    expect(insertados).toEqual([])
  })

  // El gate de la 0059: una cuenta desactivada se trata como "sin clínica".
  it("una cuenta desactivada tampoco", async () => {
    respuestas["profiles:select"] = { data: { clinic_id: CLINICA, is_active: false } }

    const res = await POST()

    expect(res.status).toBe(400)
    expect(insertados).toEqual([])
  })

  it("con el demo ya sembrado responde `already` y no duplica", async () => {
    respuestas["owners:select"] = { data: { id: "demo-existente" } }

    const res = await POST()
    const cuerpo = (await res.json()) as { ok: boolean; already: boolean }

    expect(cuerpo).toEqual({ ok: true, already: true })
    expect(insertados).toEqual([])
    expect(borrados).toEqual([])
  })
})
