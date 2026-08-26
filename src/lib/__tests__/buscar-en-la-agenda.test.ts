/**
 * El buscador de la agenda.
 *
 * Se usa en el mostrador, con alguien esperando: se escribe rápido, sin acentos y sin mayúsculas.
 * Lo que se fija acá es que eso encuentre igual.
 */
import { describe, expect, it } from "vitest"

import { coincideConLaBusqueda, type CitaBuscable } from "@/lib/agenda/buscar"

const CITA: CitaBuscable = {
  title: "Luna — Vacunación anual",
  reason: "Vacunación anual",
  patient: { name: "Luna" },
}

describe("qué encuentra", () => {
  it("por paciente, por título y por motivo", () => {
    expect(coincideConLaBusqueda(CITA, "luna")).toBe(true)
    expect(coincideConLaBusqueda(CITA, "vacunación")).toBe(true)
    expect(coincideConLaBusqueda(CITA, "anual")).toBe(true)
  })

  it("ignora acentos y mayúsculas EN LOS DOS SENTIDOS", () => {
    // Nadie escribe la tilde con un cliente esperando.
    expect(coincideConLaBusqueda(CITA, "vacunacion")).toBe(true)
    expect(coincideConLaBusqueda(CITA, "LUNA")).toBe(true)
    expect(coincideConLaBusqueda({ ...CITA, patient: { name: "Brunö" } }, "bruno")).toBe(true)
  })

  it("aguanta espacios sueltos alrededor", () => {
    expect(coincideConLaBusqueda(CITA, "  luna  ")).toBe(true)
  })
})

describe("varias palabras", () => {
  it("exige TODAS, no cualquiera", () => {
    // Con «cualquiera», escribir dos palabras devuelve más resultados que escribir una — el filtro
    // dejaría de filtrar justo cuando más se lo necesita.
    expect(coincideConLaBusqueda(CITA, "luna vacuna")).toBe(true)
    expect(coincideConLaBusqueda(CITA, "luna cirugia")).toBe(false)
  })

  it("no le importa el orden", () => {
    expect(coincideConLaBusqueda(CITA, "vacuna luna")).toBe(true)
  })
})

describe("la consulta vacía", () => {
  it("deja pasar TODO", () => {
    // Si devolviera `false`, la agenda aparecería en blanco hasta escribir algo — y el caso normal
    // de este campo es estar vacío.
    expect(coincideConLaBusqueda(CITA, "")).toBe(true)
    expect(coincideConLaBusqueda(CITA, "   ")).toBe(true)
  })
})

describe("citas incompletas", () => {
  it("una cita sin paciente ni motivo no rompe la búsqueda", () => {
    const suelta: CitaBuscable = { title: "Bloqueo", reason: null, patient: null }
    expect(coincideConLaBusqueda(suelta, "bloqueo")).toBe(true)
    expect(coincideConLaBusqueda(suelta, "luna")).toBe(false)
  })

  it("una cita sin NADA no coincide con nada, pero tampoco explota", () => {
    const vacia: CitaBuscable = { title: null, reason: null, patient: null }
    expect(coincideConLaBusqueda(vacia, "luna")).toBe(false)
    expect(coincideConLaBusqueda(vacia, "")).toBe(true)
  })
})
