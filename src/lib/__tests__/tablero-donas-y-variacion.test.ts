/**
 * Las dos piezas nuevas del tablero del 26-ago: la dona de especies y la insignia de variación.
 *
 * Las dos son puras y las dos tienen una trampa que sólo se ve con datos reales:
 *
 *   · `species` es TEXTO LIBRE. Medido contra el principal ese mismo día conviven «Perro» (55) y
 *     «perro» (2): agrupar por el valor crudo pinta dos gajos para la misma especie, con dos
 *     colores, y la dona miente.
 *   · La variación comparada contra el mes anterior COMPLETO daría una caída garantizada del 1 al
 *     28 de cada mes. Se compara contra la misma altura del mes pasado.
 */
import { describe, expect, it } from "vitest"

import { pacientesPorEspecie } from "@/lib/tablero/pacientes-por-especie"
import { variacion, ventanaDelMesAnterior } from "@/lib/tablero/comparacion"

describe("la dona de pacientes por especie", () => {
  it("agrupa las mayúsculas, las tildes y el plural en la misma especie", () => {
    const d = pacientesPorEspecie([
      { species: "Perro" },
      { species: "perro" },
      { species: "  PERROS " },
      { species: "canino" },
    ])
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ especie: "perro", etiqueta: "Perros", total: 4 })
  })

  it("lo que no reconoce va a «Otras», nunca se descarta", () => {
    // Un paciente que desaparece de la dona es peor que uno rotulado genérico: el total dejaría
    // de cuadrar con la cifra de «Pacientes» de la misma pantalla.
    const d = pacientesPorEspecie([{ species: "Hurón" }, { species: null }, { species: "" }])
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ especie: "otras", total: 3 })
  })

  it("no devuelve gajos en cero y conserva el orden fijo, no el del ranking", () => {
    // El color va con la especie: si el orden siguiera al total, los gatos cambiarían de color el
    // mes que superan a los perros y la dona habría que releerla entera.
    const d = pacientesPorEspecie([{ species: "gato" }, { species: "gato" }, { species: "perro" }])
    expect(d.map((x) => x.especie)).toEqual(["perro", "gato"])
    expect(d.every((x) => x.total > 0)).toBe(true)
  })

  it("cada especie conserva SU color aunque cambien los totales", () => {
    const pocos = pacientesPorEspecie([{ species: "perro" }, { species: "gato" }])
    const muchos = pacientesPorEspecie([
      { species: "gato" },
      { species: "gato" },
      { species: "gato" },
      { species: "perro" },
    ])
    const color = (d: ReturnType<typeof pacientesPorEspecie>, e: string) =>
      d.find((x) => x.especie === e)?.color
    expect(color(pocos, "perro")).toBe(color(muchos, "perro"))
    expect(color(pocos, "gato")).toBe(color(muchos, "gato"))
  })
})

describe("la insignia de variación", () => {
  it("calcula el porcentaje y hacia dónde va", () => {
    expect(variacion(150, 100)).toEqual({ pct: 50, sube: true })
    expect(variacion(80, 100)).toEqual({ pct: -20, sube: false })
    expect(variacion(100, 100)).toEqual({ pct: 0, sube: true })
  })

  it("no inventa un porcentaje cuando el periodo anterior fue cero", () => {
    // Pasar de 0 a 1 no es «+100 %»: no hay escala. Sin insignia es mejor que una mentira.
    expect(variacion(5, 0)).toBeNull()
    expect(variacion(0, 0)).toBeNull()
  })

  it("la ventana anterior mide LO MISMO que lo que va del mes, no el mes entero", () => {
    // 8 de marzo, 10:00 Bogotá (15:00 UTC). Lo corrido del mes son 7 días y 10 horas; la ventana
    // del mes pasado tiene que ser exactamente eso, del 1 de febrero en adelante.
    const inicioDeMarzo = new Date("2026-03-01T05:00:00.000Z") // 00:00 de Bogotá
    const ahora = new Date("2026-03-08T15:00:00.000Z")
    const { desde, hasta } = ventanaDelMesAnterior(ahora, inicioDeMarzo)

    expect(desde).toBe("2026-02-01T05:00:00.000Z")
    // Mismo tiempo corrido en los dos lados: la comparación es justa.
    expect(new Date(hasta).getTime() - new Date(desde).getTime()).toBe(
      ahora.getTime() - inicioDeMarzo.getTime(),
    )
  })

  it("cruza bien el cambio de año", () => {
    const inicioDeEnero = new Date("2026-01-01T05:00:00.000Z")
    const ahora = new Date("2026-01-03T05:00:00.000Z")
    const { desde } = ventanaDelMesAnterior(ahora, inicioDeEnero)
    expect(desde).toBe("2025-12-01T05:00:00.000Z")
  })
})
