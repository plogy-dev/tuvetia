/**
 * Los tipos de cita.
 *
 * Lo que se fija acá es el contrato con la base: la 0093 tiene un CHECK con la lista exacta, y una
 * etiqueta que la interfaz ofrezca pero el CHECK no acepte es un camino que el formulario deja
 * elegir y Postgres rebota — con un error que el vet no puede entender ni resolver.
 */
import { describe, expect, it } from "vitest"

import {
  finSegunTipo,
  nombreDelTipo,
  TIPO_BLOQUEO,
  TIPOS_DE_CITA,
  tipoDeCita,
} from "@/lib/agenda/tipos-de-cita"

/** La lista EXACTA del CHECK `appointments_tipo_conocido` de la migración 0093. */
const LOS_QUE_ACEPTA_LA_BASE = [
  "consulta_general",
  "consulta_especializada",
  "vacunacion",
  "desparasitacion",
  "cirugia",
  "laboratorio",
  "imagenes",
  "peluqueria",
  "control",
  "urgencia",
  "bloqueo",
  "otro",
]

describe("el contrato con la base", () => {
  it("todo tipo que se ofrece lo acepta el CHECK de la 0093", () => {
    for (const t of [...TIPOS_DE_CITA, TIPO_BLOQUEO]) {
      expect(LOS_QUE_ACEPTA_LA_BASE, `«${t.label}» no está en el CHECK`).toContain(t.id)
    }
  })

  it("no sobra ninguno en la base sin su definición acá", () => {
    // Al revés también importa: un tipo que la base acepta y la interfaz no sabe pintar aparecería
    // como una cita sin color ni nombre.
    const definidos = [...TIPOS_DE_CITA, TIPO_BLOQUEO].map((t) => t.id)
    expect(definidos.sort()).toEqual([...LOS_QUE_ACEPTA_LA_BASE].sort())
  })
})

describe("el bloqueo no se elige", () => {
  it("no aparece en el desplegable", () => {
    // Ofrecerlo dejaría crear una cita de tipo bloqueo CON paciente, que es justo lo que la 0093
    // rechaza: un camino que la interfaz ofrece y la base rebota.
    expect(TIPOS_DE_CITA.map((t) => t.id)).not.toContain("bloqueo")
  })

  it("pero se reconoce al leerlo de vuelta", () => {
    expect(tipoDeCita("bloqueo")?.label).toBe("Espacio reservado")
  })
})

describe("leer un tipo", () => {
  it("una cita SIN tipo devuelve null, no un tipo inventado", () => {
    // Las citas anteriores a la 0093 no tienen tipo; pintarlas como «consulta general» sería
    // inventarles un dato.
    expect(tipoDeCita(null)).toBeNull()
    expect(tipoDeCita(undefined)).toBeNull()
    expect(tipoDeCita("")).toBeNull()
    expect(nombreDelTipo(null)).toBe("—")
  })

  it("un tipo desconocido tampoco se adivina", () => {
    expect(tipoDeCita("acupuntura")).toBeNull()
  })
})

describe("los colores", () => {
  it("son tokens y NUNCA hex", () => {
    // Un `#22c55e` escrito acá es un verde que en modo oscuro grita: los tokens ya están calibrados
    // para los dos temas.
    for (const t of [...TIPOS_DE_CITA, TIPO_BLOQUEO]) {
      expect(t.color, `«${t.label}»`).toMatch(/^var\(--/)
    }
  })
})

describe("la duración por defecto", () => {
  it("una cirugía dura más que una consulta", () => {
    // Dejar la cirugía en los 30 minutos por defecto hace que se agende encima de la consulta
    // siguiente, y eso se descubre el día de la cirugía.
    const cirugia = tipoDeCita("cirugia")!.minutos
    const consulta = tipoDeCita("consulta_general")!.minutos
    expect(cirugia).toBeGreaterThan(consulta)
  })

  it("mueve el fin a partir del inicio", () => {
    expect(finSegunTipo("2026-09-01T14:00:00.000Z", "cirugia")).toBe("2026-09-01T15:30:00.000Z")
    expect(finSegunTipo("2026-09-01T14:00:00.000Z", "vacunacion")).toBe("2026-09-01T14:20:00.000Z")
  })

  it("sin tipo o con fecha ilegible no toca nada", () => {
    expect(finSegunTipo("2026-09-01T14:00:00.000Z", null)).toBeNull()
    expect(finSegunTipo("basura", "cirugia")).toBeNull()
  })

  it("todas las duraciones son positivas", () => {
    for (const t of [...TIPOS_DE_CITA, TIPO_BLOQUEO]) {
      expect(t.minutos, `«${t.label}»`).toBeGreaterThan(0)
    }
  })
})
