/**
 * El tablero a gusto de cada quien.
 *
 * LO QUE ESTOS TESTS PROTEGEN no es arrastrar bloques — eso se ve al primer intento. Es el DESFASE:
 * una preferencia guardada es una foto de los widgets que existían ese día, y el código sigue
 * cambiando. Los dos casos que van a pasar seguro son un widget retirado y uno nuevo, y los dos
 * fallan en silencio si nadie los cubre:
 *
 *   · el retirado deja un id apuntando al vacío → la pantalla en blanco,
 *   · el nuevo no aparece nunca para quien personalizó alguna vez → enviamos funciones que la mitad
 *     de los usuarios no ve, sin ninguna señal de por qué.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  CATALOGO,
  alternar,
  disposicionEfectiva,
  esPorDefecto,
  mover,
  porDefecto,
  reordenar,
  visibles,
  widgetDe,
  type IdDeWidget,
} from "@/lib/tablero/widgets"

const ids = (d: { id: string }[]) => d.map((p) => p.id)

describe("el catálogo", () => {
  it("tiene bloques y ninguno repetido", () => {
    expect(CATALOGO.length).toBeGreaterThanOrEqual(4)
    expect(new Set(CATALOGO.map((w) => w.id)).size).toBe(CATALOGO.length)
  })

  it("cada bloque dice qué contesta", () => {
    // La descripción NO es adorno: es lo único que se lee al decidir si tenerlo o no. Un panel de
    // personalizar con cinco títulos sueltos obliga a probar y ver.
    for (const w of CATALOGO) {
      expect(w.titulo.length, w.id).toBeGreaterThan(3)
      expect(w.descripcion.length, w.id).toBeGreaterThan(20)
    }
  })
})

describe("sin nada guardado", () => {
  it("sale el tablero de fábrica, entero y visible", () => {
    const d = disposicionEfectiva(null)
    expect(ids(d)).toEqual(CATALOGO.map((w) => w.id))
    expect(d.every((p) => p.visible)).toBe(true)
  })

  it("una lista vacía es lo mismo que nada", () => {
    expect(disposicionEfectiva([])).toEqual(porDefecto())
  })
})

describe("el desfase entre lo guardado y lo que existe", () => {
  it("un widget que ya no existe se ignora, no rompe", () => {
    // Se retira un bloque del catálogo y todas las preferencias que lo nombran quedan apuntando al
    // vacío. Reventar por un id viejo sería cambiar un bloque de menos por un tablero en blanco.
    const d = disposicionEfectiva([
      { id: "metricas", visible: true },
      { id: "el-widget-que-borramos", visible: true },
      { id: "citas", visible: true },
    ])
    expect(ids(d)).not.toContain("el-widget-que-borramos")
    expect(ids(d).slice(0, 2)).toEqual(["metricas", "citas"])
  })

  it("un widget nuevo APARECE, y visible", () => {
    // LA DECISIÓN QUE MÁS DISCUTIBLE PARECE Y LA MÁS IMPORTANTE. Si no apareciera, alguien que
    // personalizó una vez no vería nunca nada de lo que enviemos después — ni sabría que existe.
    const soloUno = disposicionEfectiva([{ id: "metricas", visible: true }])
    expect(soloUno).toHaveLength(CATALOGO.length)
    for (const w of CATALOGO) {
      const p = soloUno.find((x) => x.id === w.id)
      expect(p, w.id).toBeDefined()
      expect(p!.visible, w.id).toBe(true)
    }
  })

  it("lo nuevo va al FINAL, sin pisar lo que la persona ordenó", () => {
    const d = disposicionEfectiva([
      { id: "citas", visible: true },
      { id: "metricas", visible: true },
    ])
    // Lo suyo queda como lo dejó...
    expect(ids(d).slice(0, 2)).toEqual(["citas", "metricas"])
    // ...y lo que no conocía, después.
    expect(ids(d).slice(2).sort()).toEqual(
      CATALOGO.map((w) => w.id).filter((i) => i !== "citas" && i !== "metricas").sort(),
    )
  })

  it("un bloque repetido se pinta una sola vez", () => {
    const d = disposicionEfectiva([
      { id: "citas", visible: true },
      { id: "citas", visible: false },
    ])
    expect(d.filter((p) => p.id === "citas")).toHaveLength(1)
    // Manda la primera aparición, que es la que la persona ordenó.
    expect(d.find((p) => p.id === "citas")!.visible).toBe(true)
  })

  it("aguanta basura sin reventar", () => {
    // La columna es `jsonb` y la base no valida los ids a propósito: un `check` contra la lista
    // convertiría cada widget nuevo en una migración. Entonces la basura llega acá.
    const d = disposicionEfectiva([
      { id: 42 },
      { visible: true },
      null as unknown as { id: unknown },
      { id: "citas" },
    ])
    expect(ids(d)).toContain("citas")
    expect(d).toHaveLength(CATALOGO.length)
  })

  it("sin `visible` se asume que sí", () => {
    // Una preferencia vieja escrita antes de que existiera la bandera no puede dejar el tablero
    // vacío: el default seguro es mostrar.
    expect(disposicionEfectiva([{ id: "citas" }]).find((p) => p.id === "citas")!.visible).toBe(true)
  })
})

describe("apagar y prender", () => {
  it("alternar cambia sólo el que se toca", () => {
    const d = alternar(porDefecto(), "grafico")
    expect(d.find((p) => p.id === "grafico")!.visible).toBe(false)
    expect(d.filter((p) => !p.visible)).toHaveLength(1)
  })

  it("un bloque apagado no se pinta pero no se pierde", () => {
    const d = alternar(porDefecto(), "grafico")
    expect(ids(visibles(d))).not.toContain("grafico")
    // Sigue en la lista: si se pierde, al volver a prenderlo aparecería al final en vez de en su
    // lugar, y quien lo apagó por un rato perdería su orden.
    expect(ids(d)).toContain("grafico")
  })

  it("se pueden apagar todos — y eso es decisión de la persona", () => {
    let d = porDefecto()
    for (const w of CATALOGO) d = alternar(d, w.id)
    expect(visibles(d)).toHaveLength(0)
    expect(d).toHaveLength(CATALOGO.length)
  })
})

describe("mover de a uno", () => {
  it("sube y baja", () => {
    const d = porDefecto()
    const segundo = d[1].id
    expect(ids(mover(d, segundo, -1))[0]).toBe(segundo)
    expect(ids(mover(d, segundo, 1))[2]).toBe(segundo)
  })

  it("el primero no sube y el último no baja", () => {
    const d = porDefecto()
    expect(mover(d, d[0].id, -1)).toBe(d)
    expect(mover(d, d[d.length - 1].id, 1)).toBe(d)
  })

  it("un id que no está no hace nada", () => {
    const d = porDefecto()
    expect(mover(d, "no-existe" as IdDeWidget, 1)).toBe(d)
  })

  it("mueve sobre la lista COMPLETA, no sobre los visibles", () => {
    // Si saltara los ocultos, apagar un bloque cambiaría a dónde va el de abajo al subirlo — y el
    // orden guardado dejaría de coincidir con el que se ve al volver a encenderlo.
    let d = porDefecto()
    const [a, b, c] = ids(d)
    d = alternar(d, b as IdDeWidget)
    const movido = mover(d, c as IdDeWidget, -1)
    expect(ids(movido).slice(0, 3)).toEqual([a, c, b])
  })
})

describe("reordenar arrastrando", () => {
  it("saca de una posición y mete en otra", () => {
    const d = porDefecto()
    const orden = ids(d)
    const r = reordenar(d, 0, 2)
    expect(ids(r)).toEqual([orden[1], orden[2], orden[0], ...orden.slice(3)])
  })

  it("hacia atrás también", () => {
    const d = porDefecto()
    const orden = ids(d)
    expect(ids(reordenar(d, 2, 0))).toEqual([orden[2], orden[0], orden[1], ...orden.slice(3)])
  })

  it("fuera de rango o al mismo lugar no cambia nada", () => {
    const d = porDefecto()
    expect(reordenar(d, 0, 0)).toBe(d)
    expect(reordenar(d, -1, 2)).toBe(d)
    expect(reordenar(d, 0, 99)).toBe(d)
  })

  it("no pierde ni duplica bloques", () => {
    // Es lo que de verdad se rompe al escribir un reorder: un splice mal puesto duplica el
    // arrastrado y pierde otro, y el tablero pinta dos veces lo mismo.
    const d = porDefecto()
    for (let i = 0; i < d.length; i++) {
      for (let j = 0; j < d.length; j++) {
        const r = reordenar(d, i, j)
        expect(r).toHaveLength(d.length)
        expect(new Set(ids(r)).size).toBe(d.length)
      }
    }
  })
})

describe("saber si vale la pena guardar", () => {
  it("el de fábrica se reconoce", () => {
    expect(esPorDefecto(porDefecto())).toBe(true)
    expect(esPorDefecto(disposicionEfectiva(null))).toBe(true)
  })

  it("cualquier cambio deja de serlo", () => {
    expect(esPorDefecto(alternar(porDefecto(), "citas"))).toBe(false)
    expect(esPorDefecto(reordenar(porDefecto(), 0, 1))).toBe(false)
  })
})

describe("el catálogo y la pantalla no se separan", () => {
  const TABLERO = readFileSync(
    join(process.cwd(), "src", "app", "dashboard", "tablero", "page.tsx"),
    "utf8",
  )

  it("la página pinta TODOS los widgets del catálogo", () => {
    // Un widget que se agrega al catálogo y no se pinta es un casillero que se puede prender y no
    // hace nada — y como sale visible por defecto, todo el mundo se queda mirando el hueco.
    //
    // SE MIRA EL MAPA `BLOQUES`, no el archivo entero: el id de un widget también aparece en
    // comentarios y en nombres de variables, y buscar en todo el fuente daba por pintado algo que
    // sólo estaba mencionado.
    const desde = TABLERO.indexOf("const BLOQUES")
    expect(desde, "el mapa de bloques ya no existe").toBeGreaterThan(-1)
    const bloques = TABLERO.slice(desde, TABLERO.indexOf("\n  }", desde))
    for (const w of CATALOGO) {
      expect(bloques, `falta pintar "${w.id}"`).toMatch(new RegExp(`(^|\\s)${w.id}:`, "m"))
    }
  })

  it("cada id del catálogo tiene su widget", () => {
    for (const w of CATALOGO) expect(widgetDe(w.id)).toBeDefined()
  })
})
