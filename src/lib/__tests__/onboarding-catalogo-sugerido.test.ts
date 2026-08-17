// El catálogo que propone el onboarding.
//
// LO QUE SE PRUEBA ACÁ SON DOS COSAS QUE SALEN IMPRESAS EN UNA FACTURA, y por eso ninguna puede
// fallar en silencio:
//
//   1. Que un precio vacío o en cero NO cree un servicio. `catalog_items` acepta `price_cents = 0`
//      (`check (price_cents >= 0)`), así que la base no protege de nada acá: si esta guarda se
//      rompe, el catálogo se llena de servicios que no se pueden cobrar y el riel de configuración
//      dice que la clínica está lista.
//   2. Que pesos se conviertan a centavos. Equivocarse acá es un factor 100 en el precio de todo lo
//      que la clínica cobre.

import { describe, expect, it } from "vitest"

import {
  SERVICIOS_SUGERIDOS,
  cuantosServicios,
  filasDeCatalogo,
  precioUtilizable,
} from "@/lib/onboarding/catalogo-sugerido"

const CLINICA = "cli-1"

describe("un precio que no sirve no crea un servicio", () => {
  // EL CASO QUE MOTIVA EL MÓDULO. Un campo que el vet dejó vacío llega como 0 o como undefined, y la
  // base lo aceptaría: `price_cents >= 0` incluye el cero.
  it("cero NO crea nada", () => {
    expect(precioUtilizable(0)).toBe(false)
    expect(filasDeCatalogo(CLINICA, { "consulta-general": 0 })).toEqual([])
  })

  it("vacío, nulo y ausente tampoco", () => {
    expect(filasDeCatalogo(CLINICA, { "consulta-general": undefined })).toEqual([])
    expect(filasDeCatalogo(CLINICA, { "consulta-general": null })).toEqual([])
    expect(filasDeCatalogo(CLINICA, {})).toEqual([])
  })

  it("un negativo tampoco — la base lo rechazaría, pero el error saldría a mitad del onboarding", () => {
    expect(precioUtilizable(-5000)).toBe(false)
  })

  // `num()` de un campo vacío puede dar NaN, e `Infinity` sale de una división mal hecha. Los dos
  // pasarían un `> 0` ingenuo.
  it("NaN e Infinity no pasan", () => {
    expect(precioUtilizable(Number.NaN)).toBe(false)
    expect(precioUtilizable(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it("un string que parece número no pasa: el tipo importa", () => {
    expect(precioUtilizable("45000")).toBe(false)
  })
})

describe("la conversión a centavos", () => {
  // Un factor 100 mal aplicado cobra $450 donde el vet quiso $45.000, o al revés.
  it("45.000 pesos son 4.500.000 centavos", () => {
    const [fila] = filasDeCatalogo(CLINICA, { "consulta-general": 45000 })
    expect(fila.price_cents).toBe(4_500_000)
  })

  it("redondea los decimales en vez de arrastrarlos", () => {
    const [fila] = filasDeCatalogo(CLINICA, { "consulta-general": 45000.555 })
    expect(Number.isInteger(fila.price_cents)).toBe(true)
  })
})

describe("lo que se guarda", () => {
  it("sólo entran los servicios con precio; los demás se saltan sin protestar", () => {
    const filas = filasDeCatalogo(CLINICA, {
      "consulta-general": 45000,
      vacunacion: 0,
      esterilizacion: 180000,
    })
    expect(filas.map((f) => f.name)).toEqual(["Consulta general", "Esterilización"])
  })

  // Con UNO solo la clínica ya puede facturar, que es el objetivo entero del paso.
  it("con un solo servicio alcanza", () => {
    expect(filasDeCatalogo(CLINICA, { "consulta-general": 45000 })).toHaveLength(1)
  })

  it("van como SERVICIO y con su clínica", () => {
    const [fila] = filasDeCatalogo(CLINICA, { "consulta-general": 45000 })
    expect(fila).toMatchObject({ clinic_id: CLINICA, item_type: "SERVICIO" })
  })

  // La duración es lo que le dice a Athos cuánto bloque reservar: sin ella el agente sabe QUÉ
  // agendar pero no por cuánto tiempo.
  it("la duración viaja, incluida la que es null a propósito", () => {
    const filas = filasDeCatalogo(CLINICA, {
      "consulta-general": 45000,
      "hospitalizacion-dia": 90000,
    })
    expect(filas.find((f) => f.name === "Consulta general")?.duration_minutes).toBe(30)
    expect(filas.find((f) => f.name === "Hospitalización (día)")?.duration_minutes).toBeNull()
  })

  // NO se escriben `tax_rate` ni `tax_status`: los pone la columna. Si alguien los agrega acá, pasan
  // a existir en tres sitios (columna, formulario y esto) y se desincronizan — que es cómo nació el
  // `whatsapp_provider_coherente` de la auditoría.
  it("no fija IVA: deja mandar al default de la columna", () => {
    const [fila] = filasDeCatalogo(CLINICA, { "consulta-general": 45000 })
    expect(fila).not.toHaveProperty("tax_rate")
    expect(fila).not.toHaveProperty("tax_status")
  })
})

describe("la lista sugerida", () => {
  it("cabe en una pantalla de onboarding", () => {
    expect(SERVICIOS_SUGERIDOS.length).toBeLessThanOrEqual(8)
  })

  it("los id son únicos: son la clave del estado del formulario", () => {
    const ids = SERVICIOS_SUGERIDOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("ninguno trae precio: los precios los pone el veterinario", () => {
    for (const s of SERVICIOS_SUGERIDOS) expect(s).not.toHaveProperty("precio")
  })
})

describe("el contador del botón", () => {
  it("cuenta sólo los que de verdad se van a crear", () => {
    expect(cuantosServicios({ a: 45000, b: 0, c: null, d: 12000 })).toBe(2)
  })
})
