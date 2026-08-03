import { describe, expect, it } from "vitest"

import { normalizarFilaRealtime, normalizarTimestamp } from "@/lib/realtime-timestamp"

// Los dos valores de referencia salen de una medición real contra el proyecto principal
// (`select now()::text, to_json(now())::text`), no de una suposición sobre el formato.
const DEL_WAL = "2026-08-01 19:19:20.686681+00"
const DE_POSTGREST = "2026-08-01T19:19:20.686681+00:00"

describe("normalizarTimestamp", () => {
  it("convierte el formato del WAL al mismo que devuelve PostgREST", () => {
    expect(normalizarTimestamp(DEL_WAL)).toBe(DE_POSTGREST)
  })

  it("deja intacto lo que ya viene en ISO", () => {
    // La misma función corre sobre filas de los dos caminos: la puesta al día trae ISO.
    expect(normalizarTimestamp(DE_POSTGREST)).toBe(DE_POSTGREST)
  })

  it("los dos caminos ordenan igual — que es lo que la bandeja rompía", () => {
    const viejo = "2026-08-01T19:19:20.686681+00:00" // por PostgREST
    const nuevoDelWal = "2026-08-01 19:20:00.000001+00" // por Realtime, un minuto DESPUÉS

    // Sin normalizar, el mensaje nuevo compara como MENOR (' ' < 'T') y su conversación no sube.
    expect(nuevoDelWal > viejo).toBe(false)
    expect(normalizarTimestamp(nuevoDelWal) > viejo).toBe(true)
  })

  it("no pierde los microsegundos", () => {
    // Pasar por new Date().toISOString() los truncaría a milisegundos y añadiría "Z", que compara
    // distinto del valor de PostgREST para el MISMO instante.
    expect(normalizarTimestamp(DEL_WAL)).toContain(".686681")
  })

  it("completa los minutos del offset y respeta los que ya vienen", () => {
    expect(normalizarTimestamp("2026-08-01 14:19:20-05")).toBe("2026-08-01T14:19:20-05:00")
    expect(normalizarTimestamp("2026-08-01 19:19:20+05:30")).toBe("2026-08-01T19:19:20+05:30")
  })

  it("acepta segundos sin parte fraccionaria", () => {
    // Postgres recorta los ceros finales: un instante exacto llega sin decimales.
    expect(normalizarTimestamp("2026-08-01 19:19:20+00")).toBe("2026-08-01T19:19:20+00:00")
  })

  it("normaliza sólo los campos indicados de una fila, y no rompe los nulls", () => {
    // El helper de fila existe porque la regla ya se olvidó una vez: la bandeja de correo, escrita
    // en paralelo al arreglo de la de WhatsApp, nació con el mismo defecto.
    const fila = {
      id: "abc",
      created_at: DEL_WAL,
      read_at: null,
      body: "un texto con espacios que no es fecha",
    }
    const salida = normalizarFilaRealtime(fila, ["created_at", "read_at"])

    expect(salida.created_at).toBe(DE_POSTGREST)
    expect(salida.read_at).toBe(null)
    expect(salida.body).toBe(fila.body) // no se tocan campos fuera de la lista
    expect(salida.id).toBe("abc")
    expect(fila.created_at).toBe(DEL_WAL) // no muta la fila original
  })

  it("deja pasar null, undefined y cualquier cosa que no reconozca", () => {
    // read_at / delivered_at / failed_at son nullables.
    expect(normalizarTimestamp(null)).toBe(null)
    expect(normalizarTimestamp(undefined)).toBe(undefined)
    expect(normalizarTimestamp("")).toBe("")
  })
})
