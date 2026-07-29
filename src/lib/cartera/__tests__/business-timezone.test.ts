// Regresión de la zona horaria del barrido de cartera.
//
// El bug original: `isWithinAllowedWindow` evalúa la ventana de la Ley 2300 con los getters
// LOCALES de Date. En Vercel el proceso corre en UTC, así que 7:00–19:00 se leía como 7:00–19:00
// UTC = 2:00–14:00 en Colombia: habilitaba cobrar de madrugada y bloqueaba media tarde.
//
// Los tests del dominio no lo veían porque construyen las fechas con el mismo constructor local
// que el código bajo prueba — pasan igual en cualquier zona. Estos, en cambio, parten de
// INSTANTES ABSOLUTOS (ISO con Z), que es lo que llega de verdad desde la BD.

import { afterAll, describe, expect, it } from "vitest"

import { isWithinAllowedWindow } from "@/lib/facturacion/domain/reminders"
import { assertBusinessTimezone, BUSINESS_TIMEZONE } from "../business-timezone"

const SIN_FESTIVOS = new Set<string>()

// Miércoles 29 de julio de 2026, en instantes absolutos.
const MIERCOLES_3AM_COL = new Date("2026-07-29T08:00:00Z") // 03:00 en Bogotá
const MIERCOLES_4PM_COL = new Date("2026-07-29T21:00:00Z") // 16:00 en Bogotá
const MIERCOLES_10AM_COL = new Date("2026-07-29T15:00:00Z") // 10:00 en Bogotá

const tzOriginal = process.env.TZ

afterAll(() => {
  process.env.TZ = tzOriginal
})

describe("zona horaria del negocio", () => {
  it("ancla el proceso a America/Bogota al importarse", () => {
    // Importar business-timezone ya asignó process.env.TZ; Bogotá es UTC-5 fijo (sin DST).
    expect(process.env.TZ).toBe(BUSINESS_TIMEZONE)
    expect(new Date().getTimezoneOffset()).toBe(300)
  })

  it("assertBusinessTimezone pasa cuando el proceso está en la zona correcta", () => {
    expect(() => assertBusinessTimezone()).not.toThrow()
  })

  it("assertBusinessTimezone ABORTA si el proceso quedó en UTC (el caso de Vercel)", () => {
    process.env.TZ = "UTC"
    try {
      expect(() => assertBusinessTimezone()).toThrow(/Zona horaria del proceso incorrecta/)
    } finally {
      process.env.TZ = BUSINESS_TIMEZONE
    }
  })
})

describe("ventana de la Ley 2300 sobre instantes absolutos", () => {
  it("NO permite contactar a las 3 a. m. hora de Colombia", () => {
    expect(isWithinAllowedWindow(MIERCOLES_3AM_COL, SIN_FESTIVOS)).toBe(false)
  })

  it("permite contactar a las 4 p. m. hora de Colombia", () => {
    expect(isWithinAllowedWindow(MIERCOLES_4PM_COL, SIN_FESTIVOS)).toBe(true)
  })

  it("permite contactar a las 10 a. m. hora de Colombia", () => {
    expect(isWithinAllowedWindow(MIERCOLES_10AM_COL, SIN_FESTIVOS)).toBe(true)
  })

  // El corazón del bug: en UTC los dos veredictos se INVIERTEN. Si este test empieza a fallar,
  // alguien desancló el proceso de la zona del negocio.
  it("en UTC los veredictos se invierten — por eso el proceso debe ir anclado", () => {
    process.env.TZ = "UTC"
    try {
      expect(isWithinAllowedWindow(MIERCOLES_3AM_COL, SIN_FESTIVOS)).toBe(true) // madrugada permitida
      expect(isWithinAllowedWindow(MIERCOLES_4PM_COL, SIN_FESTIVOS)).toBe(false) // tarde bloqueada
    } finally {
      process.env.TZ = BUSINESS_TIMEZONE
    }
  })
})
