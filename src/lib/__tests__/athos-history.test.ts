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
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { TURNOS_POR_PACIENTE, agruparPorClave, agruparPorPaciente, type MensajeFila } from "../athos-history"

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

describe("la pantalla no esconde el historial que la base sí tiene", () => {
  // David, 25-ago: «está fallando poder ir a los chats existentes». Eran DOS bugs que se tapaban
  // entre sí, y los dos eran regresiones silenciosas posibles — por eso se escanea el fuente.
  const limpiar = (s: string) =>
    s
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")

  it("el mapa de hilos se siembra SIEMPRE, no sólo con ?patient= en la URL", () => {
    // `threads = patientParam ? historial : {}` era el bug: elegir un paciente con el selector
    // mostraba un hilo vacío aunque su conversación estuviera guardada. Que la app abra limpia lo
    // gobierna el paciente inicial (la consulta general no tiene historial), no este mapa.
    const pagina = limpiar(readFileSync("src/app/dashboard/asistente/page.tsx", "utf8"))
    expect(pagina).toContain("threads = agruparPorPaciente(")
    expect(pagina).not.toMatch(/threads\s*=\s*patientParam\s*\?/)
  })

  it("el clic del historial funciona también con la pantalla ya abierta", () => {
    // `?patient=` llega como prop y `useState` sólo lo lee al montar: la navegación suave del
    // sidebar no remonta el componente, así que sin la sincronización el clic no hacía nada.
    const asistente = limpiar(readFileSync("src/app/dashboard/asistente/assistant.tsx", "utf8"))
    const i = asistente.indexOf("initialPatientId !== patientDeLaUrl")
    expect(i, "se perdió la sincronización del ?patient= en navegación suave").toBeGreaterThan(-1)
    expect(asistente.slice(i, i + 200)).toContain("setPatientId(initialPatientId)")
  })
})

describe("agruparPorClave — los chats generales recuperables (0092)", () => {
  const fila = (over: Partial<MensajeFila>): MensajeFila => ({
    id: crypto.randomUUID(),
    patient_id: null,
    thread_key: "g100",
    role: "user",
    content: "hola",
    created_at: "2026-08-26T10:00:00Z",
    ...over,
  })

  it("agrupa por thread_key, cronológico, ignorando filas de paciente y sin clave", () => {
    const hilos = agruparPorClave([
      fila({ id: "a3", thread_key: "g200", content: "otra conversación" }),
      fila({ id: "a2", role: "assistant", content: "buenas, ¿qué caso?" }),
      fila({ id: "a1", content: "hola" }),
      fila({ id: "px", patient_id: "pac-1", thread_key: null, content: "de paciente: fuera" }),
      fila({ id: "viejo", thread_key: null, content: "general viejo sin clave: fuera" }),
    ])
    expect(Object.keys(hilos).sort()).toEqual(["g100", "g200"])
    expect(hilos.g100.map((m) => m.id)).toEqual(["a1", "a2"]) // cronológico
    expect(hilos.g100[1].role).toBe("assistant")
  })
})
