import { describe, expect, it } from "vitest"

import {
  calcularProgreso,
  TOTAL_PASOS,
  type HechosDeLaClinica,
} from "@/lib/onboarding/progreso"

const NADA: HechosDeLaClinica = {
  tieneLogo: false,
  tieneHorarios: false,
  tienePaciente: false,
  tieneServicios: false,
  whatsappConectado: false,
  tieneEquipo: false,
}

const TODO: HechosDeLaClinica = {
  tieneLogo: true,
  tieneHorarios: true,
  tienePaciente: true,
  tieneServicios: true,
  whatsappConectado: true,
  tieneEquipo: true,
}

describe("calcularProgreso", () => {
  it("una clínica recién creada arranca en 0% y con todo pendiente", () => {
    const p = calcularProgreso(NADA)
    expect(p.hechos).toBe(0)
    expect(p.porcentaje).toBe(0)
    expect(p.completo).toBe(false)
    expect(p.pasos).toHaveLength(TOTAL_PASOS)
    expect(p.pasos.every((x) => !x.hecho)).toBe(true)
  })

  it("con todo puesto llega a 100% y se declara completa", () => {
    const p = calcularProgreso(TODO)
    expect(p.hechos).toBe(TOTAL_PASOS)
    expect(p.porcentaje).toBe(100)
    expect(p.completo).toBe(true)
    expect(p.siguiente).toBeNull()
  })

  it("NUNCA muestra 100% con algo pendiente", () => {
    // Es la razón de que el cálculo use Math.floor y no Math.round. Con 5 de 6, redondear da 83%
    // y no molesta; el caso que importa es que ningún estado incompleto pueda leerse como listo.
    // Se prueba dejando pendiente cada paso, de a uno.
    for (const clave of Object.keys(TODO) as (keyof HechosDeLaClinica)[]) {
      const casi = { ...TODO, [clave]: false }
      const p = calcularProgreso(casi)
      expect(p.completo).toBe(false)
      expect(p.porcentaje).toBeLessThan(100)
    }
  })

  it("`siguiente` es el primer pendiente en el orden del riel, no uno cualquiera", () => {
    // El orden importa: los horarios habilitan que Athos agende, así que van antes que el catálogo.
    const p = calcularProgreso({ ...NADA, tieneLogo: true })
    expect(p.siguiente?.id).toBe("horarios")

    const q = calcularProgreso({ ...NADA, tieneLogo: true, tieneHorarios: true })
    expect(q.siguiente?.id).toBe("paciente")
  })

  it("cada paso lleva a una pantalla concreta y dice qué desbloquea", () => {
    // Un riel que dice "falta esto" sin decir dónde ni para qué se ignora.
    for (const paso of calcularProgreso(NADA).pasos) {
      expect(paso.href.startsWith("/dashboard")).toBe(true)
      expect(paso.porQue.length).toBeGreaterThan(0)
      expect(paso.titulo.length).toBeGreaterThan(0)
    }
  })

  it("el porcentaje acompaña a la cuenta", () => {
    const p = calcularProgreso({ ...NADA, tieneLogo: true, tieneHorarios: true, tienePaciente: true })
    expect(p.hechos).toBe(3)
    expect(p.porcentaje).toBe(Math.floor((3 / TOTAL_PASOS) * 100))
  })
})
