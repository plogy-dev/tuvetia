/**
 * Fechas ancladas a America/Bogota.
 *
 * El defecto que estos tests fijan: los server components de Next corren en **UTC** en Vercel, y
 * `toLocaleDateString("es-CO")` sin `timeZone` usa la zona del proceso. Una consulta de las 19:00 en
 * Bogotá (= 00:00 UTC del día siguiente) se renderizaba **con la fecha del día siguiente**: el
 * veterinario veía la consulta de ayer fechada hoy. Reportado por el cliente en la auditoría del
 * Milestone 2 (§4.6c).
 *
 * Se fuerza `process.env.TZ = "UTC"` para reproducir el entorno de Vercel: si alguien vuelve a
 * formatear sin `timeZone`, estos tests fallan.
 */
import { beforeAll, describe, expect, it } from "vitest"

import { bogotaDate, bogotaDateTime, bogotaTimeOf, bogotaTodayISO } from "../date-utils"

beforeAll(() => {
  process.env.TZ = "UTC" // el runtime de Vercel
})

describe("bogotaDate — la fecha no se corre de día", () => {
  it("una consulta de las 19:00 en Bogotá conserva SU día, no el del UTC siguiente", () => {
    // 2026-08-01 19:00 -05:00 === 2026-08-02 00:00 UTC
    const iso = "2026-08-02T00:00:00.000Z"
    // Se ancla al DÍA, no a un substring: `not.toContain("02")` daba falso negativo porque el año
    // "2026" contiene "02". El formato es "01 de ago de 2026", así que el día va al principio.
    expect(bogotaDate(iso)).toMatch(/^01\b/)
  })

  it("una consulta de las 23:59 en Bogotá sigue siendo del mismo día", () => {
    const iso = "2026-08-02T04:59:00.000Z" // 23:59 del 1 de agosto en Bogotá
    expect(bogotaDate(iso)).toContain("01")
  })

  it("el primer minuto del día en Bogotá no retrocede al día anterior", () => {
    const iso = "2026-08-01T05:00:00.000Z" // 00:00 del 1 de agosto en Bogotá
    expect(bogotaDate(iso)).toContain("01")
  })

  it("incluye mes y año", () => {
    const s = bogotaDate("2026-08-02T00:00:00.000Z")
    expect(s).toMatch(/ago/i)
    expect(s).toContain("2026")
  })
})

describe("bogotaDateTime — la hora es la que vio el veterinario", () => {
  it("muestra 19:00 para una consulta de las 19:00 en Bogotá", () => {
    const s = bogotaDateTime("2026-08-02T00:00:00.000Z")
    expect(s).toContain("19:00")
    expect(s).toContain("01")
  })

  it("usa reloj de 24 horas (sin a.m./p.m.)", () => {
    const s = bogotaDateTime("2026-08-02T00:00:00.000Z")
    expect(s.toLowerCase()).not.toMatch(/\ba\.?\s?m\.?|\bp\.?\s?m\.?/)
  })
})

describe("las utilidades que ya existían siguen ancladas", () => {
  it("bogotaTimeOf no se desplaza con la TZ del proceso", () => {
    expect(bogotaTimeOf("2026-08-02T00:00:00.000Z")).toBe("19:00")
  })

  it("bogotaTodayISO usa el día de Bogotá, no el de UTC", () => {
    // 00:30 UTC del 2 de agosto todavía es 1 de agosto en Bogotá.
    expect(bogotaTodayISO(new Date("2026-08-02T00:30:00.000Z"))).toBe("2026-08-01")
  })
})
