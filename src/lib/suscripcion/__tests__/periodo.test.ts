import { describe, expect, it } from "vitest"

import {
  MAX_INTENTOS,
  diasHastaProximoIntento,
  etiquetaDePeriodo,
  periodoDesde,
  soloFecha,
  toca,
  unMesDespues,
} from "@/lib/suscripcion/periodo"

// Los casos que en producción tardarían meses en aparecer, y que cuando aparecen se manifiestan
// como plata: un mes que no se cobró, o uno que se cobró dos veces.

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe("unMesDespues", () => {
  it("el caso simple: mismo día del mes siguiente", () => {
    expect(soloFecha(unMesDespues(utc("2026-09-15")))).toBe("2026-10-15")
  })

  it("31 DE ENERO NO SE VA AL 3 DE MARZO", () => {
    // `setMonth(mes + 1)` sobre un 31 de enero da el 3 de marzo, porque febrero no tiene 31 y
    // JavaScript desborda hacia adelante en silencio. Con eso, una suscripción que se renueva el 31
    // de enero se cobraría el 3 de marzo y regalaría un mes, todos los años.
    expect(soloFecha(unMesDespues(utc("2026-01-31")))).toBe("2026-02-28")
  })

  it("respeta el año bisiesto", () => {
    // 2028 es bisiesto: el mismo 31 de enero cae en 29, no en 28.
    expect(soloFecha(unMesDespues(utc("2028-01-31")))).toBe("2028-02-29")
  })

  it("31 de marzo → 30 de abril", () => {
    expect(soloFecha(unMesDespues(utc("2026-03-31")))).toBe("2026-04-30")
  })

  it("cruza el año", () => {
    expect(soloFecha(unMesDespues(utc("2026-12-15")))).toBe("2027-01-15")
  })

  it("NO repone el día original en el mes siguiente", () => {
    // Documentado como decisión: si el ciclo cayó al 28 de febrero, el próximo es el 28 de marzo y
    // no vuelve al 31. La pérdida son días a favor del cliente, y evita una columna de "día
    // preferido" que nadie puede verificar mirando la fecha de renovación.
    const feb = unMesDespues(utc("2026-01-31"))
    expect(soloFecha(unMesDespues(feb))).toBe("2026-03-28")
  })

  it("no son 30 días fijos: doce meses caen en el mismo día del año siguiente", () => {
    // Con 30 días fijos se cobrarían 12 veces en 360 días y el ciclo se desplazaría un mes cada
    // seis años.
    let d = utc("2026-01-15")
    for (let i = 0; i < 12; i++) d = unMesDespues(d)
    expect(soloFecha(d)).toBe("2027-01-15")
  })
})

describe("etiquetaDePeriodo y periodoDesde", () => {
  it("la etiqueta es el mes del INICIO", () => {
    expect(etiquetaDePeriodo(utc("2026-09-15"))).toBe("2026-09")
  })

  it("el período va del inicio a un mes después", () => {
    const p = periodoDesde(utc("2026-09-01"))
    expect(soloFecha(p.inicio)).toBe("2026-09-01")
    expect(soloFecha(p.fin)).toBe("2026-10-01")
    expect(p.etiqueta).toBe("2026-09")
  })
})

describe("diasHastaProximoIntento", () => {
  it("da el período de gracia de 6 días repartido en dos reintentos", () => {
    expect(diasHastaProximoIntento(1)).toBe(2)
    expect(diasHastaProximoIntento(2)).toBe(4)
  })

  it("null en el último intento: es la señal de bajar a free", () => {
    expect(diasHastaProximoIntento(MAX_INTENTOS)).toBeNull()
    // Defensivo: un intento por encima del máximo tampoco reintenta.
    expect(diasHastaProximoIntento(MAX_INTENTOS + 5)).toBeNull()
  })

  it("la suma de las esperas es la gracia prometida", () => {
    // Si alguien toca la tabla de esperas, este test dice cuánto cambió la promesa al cliente.
    const total = (diasHastaProximoIntento(1) ?? 0) + (diasHastaProximoIntento(2) ?? 0)
    expect(total).toBe(6)
  })
})

describe("toca", () => {
  const ahora = new Date("2026-09-15T12:00:00.000Z")

  it("cobra cuando la fecha ya pasó", () => {
    expect(toca(utc("2026-09-15"), ahora)).toBe(true)
    expect(toca(utc("2026-09-01"), ahora)).toBe(true)
  })

  it("no cobra antes de tiempo", () => {
    expect(toca(utc("2026-09-16"), ahora)).toBe(false)
  })

  it("RECUPERA un día perdido — por eso es <= y no ===", () => {
    // GitHub Actions no tiene SLA y desactiva schedules en repos sin actividad. Con comparación
    // exacta, un día que el cron no corrió sería un mes sin cobrar que nadie recupera.
    expect(toca(utc("2026-08-01"), ahora)).toBe(true)
  })

  it("sin fecha de renovación no se cobra: es una clínica free", () => {
    expect(toca(null, ahora)).toBe(false)
  })
})
