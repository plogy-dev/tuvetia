/**
 * Los links del aviso de cita — Maps y Calendar (reunión del 28-ago).
 *
 * Lo que estos tests fijan, en orden de cuánto duele si se rompe:
 *
 *  · UN LINK ROTO ES PEOR QUE NINGUNO. Sin dirección no puede salir link de Maps: una búsqueda
 *    vacía en Maps lleva a cualquier parte, y el titular que toca «Cómo llegar» y aterriza en el
 *    medio del mapa deja de confiar en los avisos.
 *  · EL FORMATO DE FECHAS DE GOOGLE ES RÍGIDO: `YYYYMMDDTHHMMSSZ`, en UTC, sin guiones ni
 *    puntos. Un milisegundo que se cuele o un guion que quede rompe el template en silencio —
 *    Google abre el editor con la fecha de hoy y el titular agenda la cita en el día equivocado.
 *  · LAS DIRECCIONES COLOMBIANAS TRAEN `#` («Cra 7 #45-12»): sin encoding, el `#` corta la URL
 *    y el query llega mutilado.
 */
import { describe, expect, it } from "vitest"

import { bloqueDeLinks, linkDeCalendario, linkDeMaps } from "@/lib/citas/links"

describe("el link de Maps", () => {
  it("codifica la dirección — incluido el # de las direcciones colombianas", () => {
    const url = linkDeMaps("Cra 7 #45-12, Bogotá")
    expect(url).toBe(
      "https://www.google.com/maps/search/?api=1&query=Cra%207%20%2345-12%2C%20Bogot%C3%A1",
    )
  })

  it("sin dirección no hay link — ni con espacios disfrazados de dirección", () => {
    expect(linkDeMaps(null)).toBeNull()
    expect(linkDeMaps(undefined)).toBeNull()
    expect(linkDeMaps("")).toBeNull()
    expect(linkDeMaps("   ")).toBeNull()
  })
})

describe("el link de Calendar", () => {
  it("las fechas van en el formato rígido de Google: UTC, sin guiones, sin milisegundos", () => {
    const url = linkDeCalendario({
      titulo: "Cita de Milo",
      // 10:30 de Bogotá = 15:30 UTC.
      inicio: "2026-08-26T10:30:00-05:00",
      fin: "2026-08-26T11:00:00-05:00",
    })
    expect(url).toContain("dates=20260826T153000Z%2F20260826T160000Z")
    expect(url).toContain("action=TEMPLATE")
    expect(url).toContain("text=Cita+de+Milo")
  })

  it("sin hora de fin, la cita se asume de 30 minutos — el template EXIGE inicio y fin", () => {
    const url = linkDeCalendario({ titulo: "Cita", inicio: "2026-08-26T10:30:00-05:00" })
    expect(url).toContain("dates=20260826T153000Z%2F20260826T160000Z")
  })

  it("la dirección viaja como location sólo cuando existe", () => {
    const con = linkDeCalendario({
      titulo: "Cita",
      inicio: "2026-08-26T10:30:00-05:00",
      direccion: "Cra 7 #45-12",
    })
    const sin = linkDeCalendario({ titulo: "Cita", inicio: "2026-08-26T10:30:00-05:00" })
    expect(con).toContain("location=Cra+7+%2345-12")
    expect(sin).not.toContain("location=")
  })
})

describe("el bloque que se anexa al aviso", () => {
  const CITA = {
    titulo: "Cita de Milo en tu clínica",
    inicio: "2026-08-26T10:30:00-05:00",
    fin: "2026-08-26T11:00:00-05:00",
    direccion: "Cra 7 #45-12, Bogotá",
  }

  it("la confirmación lleva Calendar Y Maps, separados del texto por línea en blanco", () => {
    const bloque = bloqueDeLinks({ conCalendario: true, ...CITA })
    expect(bloque.startsWith("\n\n")).toBe(true)
    expect(bloque).toContain("📅 Agregar al calendario: https://calendar.google.com/")
    expect(bloque).toContain("📍 Cómo llegar: https://www.google.com/maps/")
  })

  it("el recordatorio lleva sólo Maps — agendar la cita de mañana no aporta", () => {
    const bloque = bloqueDeLinks({ conCalendario: false, ...CITA })
    expect(bloque).not.toContain("calendario")
    expect(bloque).toContain("📍 Cómo llegar")
  })

  it("sin dirección y sin calendario, el bloque es vacío — no se anexa basura", () => {
    expect(bloqueDeLinks({ conCalendario: false, titulo: "x", inicio: CITA.inicio })).toBe("")
  })

  it("sin dirección, la confirmación conserva el Calendar (que no la necesita)", () => {
    const bloque = bloqueDeLinks({ conCalendario: true, titulo: "x", inicio: CITA.inicio })
    expect(bloque).toContain("📅")
    expect(bloque).not.toContain("📍")
  })
})
