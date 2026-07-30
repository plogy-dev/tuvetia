/**
 * Precarga del historial del asistente.
 *
 * `athos_messages` guardaba la conversación desde el inicio, pero el asistente se montaba sin ella:
 * al recargar la página el hilo se veía vacío aunque los mensajes siguieran en la base, y el cliente
 * lo reportó como "historial inexistente" (§4.5 de la auditoría del Milestone 2).
 *
 * La parte con riesgo real es el ORDEN: la consulta trae las filas del más reciente al más antiguo
 * (para que el tope se quede con las últimas), y el hilo tiene que quedar cronológico o el
 * veterinario lee la conversación al revés.
 */
import { describe, expect, it } from "vitest"

import { TURNOS_POR_PACIENTE, agruparPorPaciente, type MensajeFila } from "../athos-history"

function fila(over: Partial<MensajeFila> & { id: string }): MensajeFila {
  return {
    patient_id: "pac-1",
    role: "user",
    content: "texto",
    created_at: "2026-07-29T10:00:00Z",
    ...over,
  }
}

const texto = (m: { parts: unknown[] }) => (m.parts[0] as { text: string }).text

// Como llegan de la consulta: `order created_at desc`.
const MAS_RECIENTE_PRIMERO: MensajeFila[] = [
  fila({ id: "3", role: "assistant", content: "tercero", created_at: "2026-07-29T10:02:00Z" }),
  fila({ id: "2", role: "user", content: "segundo", created_at: "2026-07-29T10:01:00Z" }),
  fila({ id: "1", role: "user", content: "primero", created_at: "2026-07-29T10:00:00Z" }),
]

describe("agruparPorPaciente", () => {
  it("devuelve el hilo en orden CRONOLÓGICO, no como viene de la consulta", () => {
    const hilo = agruparPorPaciente(MAS_RECIENTE_PRIMERO)["pac-1"]
    expect(hilo.map(texto)).toEqual(["primero", "segundo", "tercero"])
  })

  it("arma los parts en el formato que renderiza el asistente", () => {
    const hilo = agruparPorPaciente([fila({ id: "1", content: "hola" })])["pac-1"]
    expect(hilo[0].parts).toEqual([{ type: "text", text: "hola" }])
    expect(hilo[0].id).toBe("1")
  })

  it("separa los hilos por paciente", () => {
    const out = agruparPorPaciente([
      fila({ id: "a", patient_id: "pac-1", content: "de uno" }),
      fila({ id: "b", patient_id: "pac-2", content: "de dos" }),
    ])
    expect(Object.keys(out).sort()).toEqual(["pac-1", "pac-2"])
    expect(texto(out["pac-2"][0])).toBe("de dos")
  })

  it("descarta la consulta general (patient_id null): el backend la trata como sin estado", () => {
    expect(Object.keys(agruparPorPaciente([fila({ id: "x", patient_id: null })]))).toHaveLength(0)
  })

  it("descarta mensajes vacíos o en blanco", () => {
    const out = agruparPorPaciente([
      fila({ id: "1", content: "   " }),
      fila({ id: "2", content: "" }),
      fila({ id: "3", content: "válido" }),
    ])
    expect(out["pac-1"]).toHaveLength(1)
  })

  it("normaliza el rol: lo que no es 'user' se muestra como del asistente", () => {
    const out = agruparPorPaciente([
      fila({ id: "3", role: "system", content: "c" }),
      fila({ id: "2", role: "assistant", content: "b" }),
      fila({ id: "1", role: "user", content: "a" }),
    ])
    expect(out["pac-1"].map((m) => m.role)).toEqual(["user", "assistant", "assistant"])
  })

  it("con el tope por paciente conserva los MÁS RECIENTES, no los primeros", () => {
    // 40 mensajes, del más reciente (msg39) al más antiguo (msg0), como los ordena la consulta.
    const muchos = Array.from({ length: 40 }, (_, i) => {
      const n = 39 - i
      return fila({
        id: `m${n}`,
        content: `msg${n}`,
        created_at: `2026-07-29T10:${String(n).padStart(2, "0")}:00Z`,
      })
    })
    const hilo = agruparPorPaciente(muchos)["pac-1"]
    expect(hilo).toHaveLength(TURNOS_POR_PACIENTE)
    expect(texto(hilo[hilo.length - 1])).toBe("msg39") // el más nuevo, al final
    expect(texto(hilo[0])).toBe("msg10") // se cortaron los 10 más viejos, no los nuevos
  })

  it("sin mensajes devuelve un mapa vacío, no revienta", () => {
    expect(agruparPorPaciente([])).toEqual({})
  })
})
