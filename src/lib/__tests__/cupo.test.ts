import { describe, expect, it } from "vitest"

import { estadoDelCupo, proporcionUsada, UMBRAL_ESCASO, type CupoVisible } from "@/lib/cupo"

const cupo = (over: Partial<CupoVisible>): CupoVisible => ({
  tope: 500,
  usadas: 100,
  restantes: 400,
  reinicia: "2026-09-01",
  ...over,
})

describe("estadoDelCupo", () => {
  it("SIN tope no se pinta nada — es el estado de hoy en todas las clínicas", () => {
    // Un medidor de un límite que no existe es ruido permanente, y encima insinúa un plan que
    // todavía no se vende.
    expect(estadoDelCupo(null)).toBe("sin-tope")
    expect(estadoDelCupo(undefined)).toBe("sin-tope")
    expect(estadoDelCupo(cupo({ tope: null, restantes: null }))).toBe("sin-tope")
  })

  it("con cupo de sobra no se gasta espacio en una barra", () => {
    expect(estadoDelCupo(cupo({ usadas: 100, restantes: 400 }))).toBe("holgado")
  })

  it("avisa al 15% restante, con margen para reaccionar", () => {
    expect(estadoDelCupo(cupo({ usadas: 425, restantes: 75 }))).toBe("escaso") // justo en el 15%
    expect(estadoDelCupo(cupo({ usadas: 424, restantes: 76 }))).toBe("holgado") // uno antes, todavía no
    expect(UMBRAL_ESCASO).toBe(0.15)
  })

  it("sin restantes es agotado, no escaso", () => {
    expect(estadoDelCupo(cupo({ usadas: 500, restantes: 0 }))).toBe("agotado")
  })

  it("un tope de 0 es agotado desde el arranque, sin dividir por cero", () => {
    expect(estadoDelCupo(cupo({ tope: 0, usadas: 0, restantes: 0 }))).toBe("agotado")
  })
})

describe("proporcionUsada", () => {
  it("da la fracción gastada", () => {
    expect(proporcionUsada(cupo({ tope: 500, usadas: 250 }))).toBe(0.5)
  })

  it("se topa en 1 cuando la clínica se pasó", () => {
    // La cuenta va un turno atrás, así que pasarse por unas pocas llamadas es esperable. Una barra
    // al 103% se sale de su caja.
    expect(proporcionUsada(cupo({ tope: 500, usadas: 515 }))).toBe(1)
  })

  it("no divide por cero", () => {
    expect(proporcionUsada(cupo({ tope: 0, usadas: 0 }))).toBe(1)
  })

  it("sin tope no hay barra que dibujar", () => {
    expect(proporcionUsada(cupo({ tope: null }))).toBe(0)
  })
})
