/**
 * Los tres niveles de la barra, guardados en dos columnas.
 *
 * Lo que se fija acá es la IDA Y VUELTA: el endpoint traduce nivel → columnas para guardar, y la
 * barra traduce columnas → nivel para pintar el punto activo. Si las dos no son inversas, el vet ve
 * un nivel distinto del que tiene — y en el tercero eso significa creer que VetGPT NO agenda solo
 * cuando sí lo hace, o al revés.
 */
import { describe, expect, it } from "vitest"

import {
  columnasDelNivel,
  nivelDeLasColumnas,
  type NivelDeAutonomia,
} from "@/lib/whatsapp/nivel-de-autonomia"

const NIVELES: NivelDeAutonomia[] = ["review", "auto", "confirma"]

describe("nivel ↔ columnas", () => {
  it("ida y vuelta: guardar y volver a leer da el mismo nivel", () => {
    for (const nivel of NIVELES) {
      const { agentMode, confirmaSolo } = columnasDelNivel(nivel)
      expect(nivelDeLasColumnas(agentMode, confirmaSolo), nivel).toBe(nivel)
    }
  })

  it("sólo `confirma` enciende la confirmación automática", () => {
    expect(columnasDelNivel("confirma")).toEqual({ agentMode: "auto", confirmaSolo: true })
    expect(columnasDelNivel("auto")).toEqual({ agentMode: "auto", confirmaSolo: false })
    expect(columnasDelNivel("review")).toEqual({ agentMode: "review", confirmaSolo: false })
  })

  it("bajar de nivel APAGA la confirmación automática", () => {
    // Un interruptor que no apaga es peor que no tenerlo, y acá lo que no se apagaría es la clínica
    // agendando sola después de haber pedido que no. Por eso `confirmaSolo` se escribe siempre,
    // también cuando es false.
    expect(columnasDelNivel("auto").confirmaSolo).toBe(false)
    expect(columnasDelNivel("review").confirmaSolo).toBe(false)
  })

  it("`confirma_citas_solo` sin `agent_mode=auto` NO es el nivel 3", () => {
    // Es una fila incoherente que la base permite. Manda `agent_mode`, porque es lo que de verdad
    // decide si el agente habla: pintar el 3 ahí le diría al vet que VetGPT agenda solo cuando en
    // realidad no contesta ni un mensaje.
    expect(nivelDeLasColumnas("review", true)).toBe("review")
    expect(nivelDeLasColumnas("paused", true)).toBe("review")
  })

  it("los modos sin interfaz caen en el primer nivel, no explotan", () => {
    for (const modo of ["paused", "intervene", null, undefined, "cualquier-cosa"]) {
      expect(nivelDeLasColumnas(modo, false), String(modo)).toBe("review")
    }
  })

  it("un `confirma_citas_solo` nulo cuenta como apagado", () => {
    // Es lo que devuelve la base para las filas anteriores a la migración 0102.
    expect(nivelDeLasColumnas("auto", null)).toBe("auto")
    expect(nivelDeLasColumnas("auto", undefined)).toBe("auto")
  })
})
