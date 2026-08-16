// El briefing diario: la única pieza de la capa agéntica que gasta IA.
//
// LO QUE SE PRUEBA ACÁ ES CUÁNDO NO SE LLAMA AL MODELO. Todo lo demás del riel sale de consultas a
// la base y cuesta cero; esto cuesta tokens en cada disparo, sin que ningún vet lo haya pedido. Una
// guarda que se rompa no falla: simplemente empieza a cobrar en silencio.
import { describe, expect, it } from "vitest"

import {
  limpiarBriefing,
  pedidoDelBriefing,
  valeLaPenaRedactar,
  type InsumosDelBriefing,
} from "@/lib/briefing/armar"

const VACIO: InsumosDelBriefing = { pendientes: [], citas: [] }
const UN_PENDIENTE = { id: "notas-sin-aprobar", etiqueta: "3 notas sin aprobar", detalle: "No entran a la historia" }

describe("cuándo NO se llama al modelo", () => {
  // Un briefing que diga "hoy no tenés nada pendiente" cuesta lo mismo que uno útil y no le sirve a
  // nadie: la ausencia de pendientes ya se ve sola en el riel, que no pinta la sección.
  it("sin pendientes y sin citas no vale la pena redactar", () => {
    expect(valeLaPenaRedactar(VACIO)).toBe(false)
  })

  it("con un solo pendiente ya vale", () => {
    expect(valeLaPenaRedactar({ ...VACIO, pendientes: [UN_PENDIENTE] })).toBe(true)
  })

  it("con citas pero sin pendientes también vale", () => {
    expect(valeLaPenaRedactar({ ...VACIO, citas: [{ hora: "09:00", etiqueta: "Pequitas" }] })).toBe(true)
  })
})

describe("el pedido lleva TODO lo que el modelo necesita", () => {
  // El briefing no tiene herramientas y no consulta nada: si un dato no está en el pedido, no
  // existe. Es a propósito — uno que saliera a buscar podría contradecir al riel, y ya sabemos cómo
  // termina eso (la insignia de evidencia que decía lo contrario del juez).
  it("los pendientes van con su etiqueta y su detalle", () => {
    const p = pedidoDelBriefing({ ...VACIO, pendientes: [UN_PENDIENTE] })
    expect(p).toContain("3 notas sin aprobar")
    expect(p).toContain("No entran a la historia")
  })

  it("las citas van con hora y con quién", () => {
    const p = pedidoDelBriefing({ ...VACIO, citas: [{ hora: "09:30", etiqueta: "Pequitas · control" }] })
    expect(p).toContain("09:30")
    expect(p).toContain("Pequitas · control")
  })

  it("el nombre de la clínica entra, para que no hable de 'la veterinaria'", () => {
    expect(pedidoDelBriefing({ ...VACIO, clinica: "Clínica Norte" })).toContain("Clínica Norte")
  })

  // La regla que más importa del prompt: sin ella el modelo rellena con pacientes y motivos
  // plausibles, y esto se muestra como si fuera el estado real de la clínica.
  it("le prohíbe inventar", () => {
    expect(pedidoDelBriefing(VACIO)).toMatch(/no inventes/i)
  })

  it("pide dos o tres frases, no un informe", () => {
    expect(pedidoDelBriefing(VACIO)).toMatch(/frases/i)
  })

  it("el orden de los pendientes se respeta: primero el que tiene gente esperando", () => {
    const p = pedidoDelBriefing({
      ...VACIO,
      pendientes: [
        { id: "conversaciones", etiqueta: "2 titulares sin respuesta", detalle: "d" },
        UN_PENDIENTE,
      ],
    })
    expect(p.indexOf("titulares sin respuesta")).toBeLessThan(p.indexOf("notas sin aprobar"))
  })
})

describe("lo que devuelve el modelo se limpia antes de mostrarlo", () => {
  // El prompt prohíbe las viñetas, pero un prompt es una preferencia, no una garantía. Lo que entra
  // a la pantalla se controla acá.
  it("quita viñetas aunque el prompt las haya prohibido", () => {
    expect(limpiarBriefing("- Tenés 3 notas.\n- Y dos citas.")).toBe("Tenés 3 notas. Y dos citas.")
    expect(limpiarBriefing("• Una cosa")).toBe("Una cosa")
  })

  it("colapsa los saltos de línea en un párrafo", () => {
    expect(limpiarBriefing("Primera frase.\n\nSegunda frase.")).toBe("Primera frase. Segunda frase.")
  })

  it("recorta espacios de sobra", () => {
    expect(limpiarBriefing("  Hola   mundo  ")).toBe("Hola mundo")
  })

  // Un modelo que devuelve vacío no puede escribir una fila en blanco en la base: el barrido lo
  // trata como "nada que contar".
  it("una respuesta vacía queda vacía, para que el barrido la descarte", () => {
    expect(limpiarBriefing("   \n\n  ")).toBe("")
  })
})
