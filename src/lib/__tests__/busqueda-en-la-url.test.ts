// Los filtros que viven en la URL.
//
// POR QUÉ SE PRUEBA ESTO Y NO EL COMPONENTE: el repo corre vitest en `environment: "node"` y no
// monta componentes. Lo que se puede verificar de `FormularioDeFiltros` es qué URL construye, y eso
// es esta función.

import { describe, expect, it } from "vitest"

import { construirBusqueda, rutaConBusqueda } from "@/lib/busqueda-en-la-url"

/** Un `FormData` sin DOM: la función acepta cualquier iterable de pares. */
const campos = (...pares: [string, string][]) => pares

describe("construir la query", () => {
  it("sin campos no hay query", () => {
    expect(construirBusqueda(campos())).toBe("")
  })

  it("arma los pares en orden", () => {
    expect(construirBusqueda(campos(["q", "luna"], ["orden", "asc"]))).toBe("q=luna&orden=asc")
  })

  // LA DIFERENCIA CON EL ENVÍO NATIVO. Un <form> manda `q=` con el campo en blanco, y eso deja
  // parámetros muertos que después hay que ignorar en cada página.
  it("los campos vacíos no viajan", () => {
    expect(construirBusqueda(campos(["q", ""], ["nota", "pendiente"]))).toBe("nota=pendiente")
    expect(construirBusqueda(campos(["q", "   "]))).toBe("")
  })

  it("borrar el buscador limpia el filtro: el parámetro deja de estar", () => {
    expect(construirBusqueda(campos(["q", ""]))).toBe("")
  })

  it("recorta los bordes", () => {
    expect(construirBusqueda(campos(["q", "  luna  "]))).toBe("q=luna")
  })

  it("escapa lo que hay que escapar", () => {
    expect(construirBusqueda(campos(["q", "maría & cía"]))).toBe("q=mar%C3%ADa+%26+c%C3%ADa")
  })

  // Un filtro es texto. Un File en la URL no significa nada.
  it("lo que no es texto se descarta", () => {
    const conArchivo = [["q", "luna"], ["foto", { name: "x.png" }]] as unknown as [
      string,
      FormDataEntryValue,
    ][]
    expect(construirBusqueda(conArchivo)).toBe("q=luna")
  })
})

describe("la ruta a la que se navega", () => {
  it("sin filtros queda la ruta pelada, sin el ? colgando", () => {
    expect(rutaConBusqueda("/dashboard/consultas", campos())).toBe("/dashboard/consultas")
    expect(rutaConBusqueda("/dashboard/consultas", campos(["q", "  "]))).toBe("/dashboard/consultas")
  })

  it("con filtros los cuelga", () => {
    expect(rutaConBusqueda("/dashboard/patients", campos(["q", "luna"]))).toBe(
      "/dashboard/patients?q=luna",
    )
  })
})
