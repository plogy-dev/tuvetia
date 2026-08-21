import { describe, expect, it } from "vitest"

import {
  CATALOGO_DE_METRICAS,
  alternarMetrica,
  catalogoOfrecido,
  metricaDe,
  metricasAPintar,
  metricasEfectivas,
  metricasVisibles,
  moverMetrica,
  type IdDeMetrica,
} from "@/lib/tablero/metricas"

// Lo que se prueba acá es la RECONCILIACIÓN, que es donde esto se rompe: una preferencia guardada
// es una foto del día que se guardó y el catálogo sigue cambiando. Nadie lo prueba a mano porque
// para verlo hay que tener una fila vieja en la base.

const DE_FABRICA = CATALOGO_DE_METRICAS.filter((m) => m.porDefecto).map((m) => m.id)
const OPCIONALES = CATALOGO_DE_METRICAS.filter((m) => !m.porDefecto).map((m) => m.id)

describe("el catálogo", () => {
  it("no repite ids", () => {
    // Un id duplicado pintaría la misma cifra dos veces y rompería la reconciliación en silencio.
    const ids = CATALOGO_DE_METRICAS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("tiene un conjunto de fábrica corto — la tira es un vistazo, no una planilla", () => {
    expect(DE_FABRICA.length).toBeGreaterThan(0)
    expect(DE_FABRICA.length).toBeLessThanOrEqual(5)
  })

  it("ofrece opciones además de las de fábrica, que es todo el pedido", () => {
    expect(OPCIONALES.length).toBeGreaterThan(0)
  })

  it("toda métrica tiene etiqueta, pista y descripción", () => {
    for (const m of CATALOGO_DE_METRICAS) {
      expect(m.label.trim(), `${m.id} sin label`).toBeTruthy()
      expect(m.hint.trim(), `${m.id} sin hint`).toBeTruthy()
      expect(m.descripcion.trim(), `${m.id} sin descripción`).toBeTruthy()
    }
  })

  it("las de plata están marcadas como dependientes de facturación", () => {
    for (const m of CATALOGO_DE_METRICAS) {
      if (m.dinero) expect(m.requiere, `${m.id} es dinero pero no exige facturación`).toBe("facturacion")
    }
  })
})

describe("metricasEfectivas", () => {
  it("sin preferencia guardada, enciende sólo las de fábrica", () => {
    const d = metricasEfectivas(null)

    expect(metricasVisibles(d).map((p) => p.id)).toEqual(DE_FABRICA)
    // El resto está, pero apagado: la pantalla de personalizar necesita las dos listas.
    expect(d.length).toBe(CATALOGO_DE_METRICAS.length)
  })

  it("respeta lo que la persona eligió, encendido y apagado", () => {
    const d = metricasEfectivas([
      { id: "titulares", visible: true },
      { id: "consultas-mes", visible: false },
    ])

    const porId = new Map(d.map((p) => [p.id, p.visible]))
    expect(porId.get("titulares")).toBe(true)
    expect(porId.get("consultas-mes")).toBe(false)
  })

  it("respeta el ORDEN guardado, no el del catálogo", () => {
    const d = metricasEfectivas([
      { id: "titulares", visible: true },
      { id: "pacientes", visible: true },
    ])

    expect(d.slice(0, 2).map((p) => p.id)).toEqual(["titulares", "pacientes"])
  })

  // LA REGLA QUE SE APARTA DE `widgets.ts`, Y ESTÁ FIJADA A PROPÓSITO.
  it("una métrica OPCIONAL nueva NO se enciende sola", () => {
    // Alguien que guardó sólo dos cifras no debería encontrarse la tira llena al día siguiente:
    // cada una que se prende sola angosta a las demás.
    const d = metricasEfectivas([
      { id: "consultas-mes", visible: true },
      { id: "pacientes", visible: true },
    ])

    for (const id of OPCIONALES) {
      const p = d.find((x) => x.id === id)
      expect(p?.visible, `${id} se encendió sola`).toBe(false)
    }
  })

  it("una métrica DE FÁBRICA nueva sí aparece encendida", () => {
    // Si no, quien personalizó una vez no vería jamás una cifra que se considera básica.
    const d = metricasEfectivas([{ id: "titulares", visible: true }])

    for (const id of DE_FABRICA) {
      expect(d.find((x) => x.id === id)?.visible, `${id} no apareció`).toBe(true)
    }
  })

  it("ignora ids que ya no existen en vez de reventar", () => {
    const d = metricasEfectivas([
      { id: "una-metrica-que-se-retiro", visible: true },
      { id: "pacientes", visible: true },
    ])

    expect(d.some((p) => (p.id as string) === "una-metrica-que-se-retiro")).toBe(false)
    expect(d.find((p) => p.id === "pacientes")?.visible).toBe(true)
  })

  it("ignora duplicados: pintar dos veces la misma cifra es peor que no pintarla", () => {
    const d = metricasEfectivas([
      { id: "pacientes", visible: true },
      { id: "pacientes", visible: false },
    ])

    expect(d.filter((p) => p.id === "pacientes")).toHaveLength(1)
  })

  it("aguanta basura sin caerse", () => {
    expect(() => metricasEfectivas([{}, { id: 42 }, { id: null }] as never)).not.toThrow()
    expect(metricasEfectivas(undefined).length).toBe(CATALOGO_DE_METRICAS.length)
  })
})

describe("facturación", () => {
  it("sin el módulo activo, las cifras de plata no se ofrecen", () => {
    const ids = catalogoOfrecido(false).map((m) => m.id)

    expect(ids).not.toContain("facturado-mes")
    expect(ids).not.toContain("por-cobrar")
    expect(ids).toContain("pacientes")
  })

  it("con el módulo activo se ofrecen todas", () => {
    expect(catalogoOfrecido(true).length).toBe(CATALOGO_DE_METRICAS.length)
  })

  // El caso que evita ceros permanentes: alguien la prendió, después se desactivó facturación.
  it("una cifra de plata encendida NO se pinta si el módulo está apagado", () => {
    const d = metricasEfectivas([{ id: "por-cobrar", visible: true }])

    expect(metricasAPintar(d, false).map((p) => p.id)).not.toContain("por-cobrar")
    expect(metricasAPintar(d, true).map((p) => p.id)).toContain("por-cobrar")
  })

  it("apagar facturación no BORRA la preferencia — vuelve si se reactiva", () => {
    const d = metricasEfectivas([{ id: "por-cobrar", visible: true }])

    expect(d.find((p) => p.id === "por-cobrar")?.visible).toBe(true)
  })
})

describe("mover y alternar", () => {
  it("mover intercambia con el vecino", () => {
    const d = metricasEfectivas(null)
    const antes = d.map((p) => p.id)
    const despues = moverMetrica(d, antes[1], -1).map((p) => p.id)

    expect(despues[0]).toBe(antes[1])
    expect(despues[1]).toBe(antes[0])
  })

  it("mover en los bordes no hace nada ni rompe", () => {
    const d = metricasEfectivas(null)

    expect(moverMetrica(d, d[0].id, -1)).toEqual(d)
    expect(moverMetrica(d, d[d.length - 1].id, 1)).toEqual(d)
    expect(moverMetrica(d, "no-existe" as IdDeMetrica, 1)).toEqual(d)
  })

  // Mover sobre la lista COMPLETA y no sobre las visibles: si saltara las apagadas, encender una
  // cambiaría el orden guardado sin que nadie lo tocara.
  it("mover cuenta también las apagadas", () => {
    const d = metricasEfectivas(null)
    const primeraApagada = d.findIndex((p) => !p.visible)

    const movida = moverMetrica(d, d[primeraApagada].id, -1)

    expect(movida[primeraApagada - 1].id).toBe(d[primeraApagada].id)
  })

  it("alternar enciende y apaga sin tocar a las demás", () => {
    const d = metricasEfectivas(null)
    const uno = alternarMetrica(d, "pacientes")

    expect(uno.find((p) => p.id === "pacientes")?.visible).toBe(false)
    expect(uno.find((p) => p.id === "consultas-mes")?.visible).toBe(true)
    expect(alternarMetrica(uno, "pacientes").find((p) => p.id === "pacientes")?.visible).toBe(true)
  })
})

describe("metricaDe", () => {
  it("devuelve los datos de una métrica conocida", () => {
    expect(metricaDe("pacientes")?.label).toBe("Pacientes")
  })

  it("devuelve undefined ante un id desconocido, sin lanzar", () => {
    expect(metricaDe("inventada" as IdDeMetrica)).toBeUndefined()
  })
})
