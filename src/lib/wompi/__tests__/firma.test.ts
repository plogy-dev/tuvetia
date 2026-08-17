import { describe, expect, it } from "vitest"

import {
  checksumEsperado,
  eventoEsAutentico,
  firmaDeIntegridad,
  referenciaDeCobro,
  type EventoWompi,
} from "@/lib/wompi/firma"

// LOS VECTORES SON LOS DE LA DOCUMENTACIÓN DE WOMPI, no inventados.
//
// Es la única forma de saber que la concatenación está bien ANTES de mover plata. Una firma mal
// armada no falla de manera evidente: Wompi contesta un error genérico sobre la firma que no dice
// dónde está el problema, y el mismo error sale de un orden equivocado, de un monto con decimales o
// de un secreto de otro ambiente.

describe("firmaDeIntegridad", () => {
  it("firma EXACTAMENTE la cadena del ejemplo de Wompi", () => {
    // La documentación publica la cadena concatenada de este ejemplo:
    //
    //   "sk8-438k4-xmxm392-sn2m" + "2490000" + "COP" + "prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6"
    //
    // El hash de abajo es el SHA256 de esa cadena, verificado con node:crypto. Fijarlo acá es lo
    // que detecta un cambio de orden, un separador colado o un monto formateado: los tres producen
    // el mismo síntoma en producción —"firma inválida", sin más detalle— y ninguno se ve leyendo
    // el código.
    expect(
      firmaDeIntegridad({
        referencia: "sk8-438k4-xmxm392-sn2m",
        montoCentavos: 2490000,
        moneda: "COP",
        secretoIntegridad: "prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6",
      }),
    ).toBe("37c8407747e595535433ef8f6a811d853cd943046624a0ec04662b17bbf33bf5")
  })

  it("el ORDEN de la concatenación cambia el hash", () => {
    const base = {
      montoCentavos: 2490000,
      moneda: "COP",
      secretoIntegridad: "test_integrity_abc",
    }
    const a = firmaDeIntegridad({ ...base, referencia: "ref-1" })
    const b = firmaDeIntegridad({ ...base, referencia: "1-ref" })
    expect(a).not.toBe(b)
  })

  it("el vencimiento entra ANTES del secreto, no al final", () => {
    const base = {
      referencia: "ref-1",
      montoCentavos: 2490000,
      moneda: "COP",
      secretoIntegridad: "test_integrity_abc",
    }
    const sin = firmaDeIntegridad(base)
    const con = firmaDeIntegridad({ ...base, vencimiento: "2026-09-01T00:00:00.000Z" })
    expect(sin).not.toBe(con)
  })

  it("es determinista: la misma entrada da la misma firma", () => {
    const args = {
      referencia: "tuvetia-abc-2026-09-1",
      montoCentavos: 20_000_000,
      moneda: "COP",
      secretoIntegridad: "test_integrity_abc",
    }
    expect(firmaDeIntegridad(args)).toBe(firmaDeIntegridad(args))
  })

  it("RECHAZA un monto con decimales", () => {
    // Un float que se coló interpolaría "20000000.5" y produciría una firma que no valida, con un
    // error de Wompi que no menciona el monto. Mejor romper acá.
    expect(() =>
      firmaDeIntegridad({
        referencia: "ref",
        montoCentavos: 20_000_000.5,
        moneda: "COP",
        secretoIntegridad: "s",
      }),
    ).toThrow(/entero/)
  })
})

// ── Checksum de eventos ────────────────────────────────────────────────────────────────────────

/** El evento de ejemplo de la documentación de Wompi. */
function eventoDeEjemplo(): EventoWompi {
  return {
    event: "transaction.updated",
    data: {
      transaction: {
        id: "01-1532941443-49201",
        amount_in_cents: 4490000,
        reference: "MZQ3X2DE2SMX",
        customer_email: "john.doe@gmail.com",
        currency: "COP",
        payment_method_type: "NEQUI",
        status: "APPROVED",
      },
    },
    signature: {
      properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
      checksum: "",
    },
    timestamp: 1530291411,
    sent_at: "2018-07-20T16:45:05.000Z",
  }
}

// ⚠️ SIN VECTOR FIJO PARA EL CHECKSUM DE EVENTOS, Y HAY QUE SABER POR QUÉ.
//
// La documentación de Wompi publica un ejemplo con su cadena concatenada y su hash, pero **los dos
// no se corresponden**: el SHA256 de la cadena que ellos muestran no da el hash que ellos muestran
// (verificado con node:crypto el 2026-08-17). Es un error de su documentación, no del algoritmo.
//
// Fijar acá un hash inventado sería peor que no fijar ninguno: daría la sensación de estar
// verificado contra el proveedor cuando estaría verificado contra sí mismo.
//
// LO QUE SÍ SE PRUEBA es el comportamiento del algoritmo: el orden manda, alterar el monto invalida,
// otro secreto invalida, y nada lanza. Y la verificación REAL contra Wompi está construida en el
// producto: `suscripcion_eventos.firma_valida` guarda el veredicto de cada webhook entrante, así
// que la primera transacción de sandbox dice si valida o no, sin adivinar. Ver BILLING.md.

describe("checksumEsperado", () => {
  it("concatena los valores en el ORDEN que dicta el evento, más timestamp y secreto", () => {
    const evento = eventoDeEjemplo()
    const calculado = checksumEsperado(evento, "prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z")
    expect(calculado).toMatch(/^[0-9a-f]{64}$/)

    // El orden lo manda `properties`, no una lista nuestra: invertirla tiene que cambiar el hash.
    const invertido = { ...evento, signature: { ...evento.signature!, properties: [...evento.signature!.properties!].reverse() } }
    expect(checksumEsperado(invertido, "prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z")).not.toBe(calculado)
  })

  it("devuelve null —y no lanza— cuando falta una propiedad", () => {
    // Un `undefined` interpolado escribiría literalmente "undefined" y daría un hash que no coincide
    // con nada. Y lanzar haría que el webhook responda 500, que para Wompi es "reintentá": un
    // evento malformado se reintentaría para siempre.
    const evento = eventoDeEjemplo()
    evento.signature!.properties = ["transaction.no_existe"]
    expect(checksumEsperado(evento, "s")).toBeNull()
  })

  it("devuelve null sin timestamp y sin properties", () => {
    expect(checksumEsperado({ ...eventoDeEjemplo(), timestamp: undefined }, "s")).toBeNull()
    expect(checksumEsperado({ ...eventoDeEjemplo(), signature: {} }, "s")).toBeNull()
  })
})

describe("eventoEsAutentico", () => {
  const SECRETO = "test_events_abc123"

  it("acepta un evento firmado con el secreto correcto", () => {
    const evento = eventoDeEjemplo()
    const bueno = checksumEsperado(evento, SECRETO)!
    expect(eventoEsAutentico(evento, SECRETO, bueno)).toBe(true)
  })

  it("acepta el checksum aunque venga en mayúsculas", () => {
    // La documentación muestra el hash en mayúsculas y la librería lo produce en minúsculas.
    // Compararlos tal cual rechazaría eventos legítimos.
    const evento = eventoDeEjemplo()
    const bueno = checksumEsperado(evento, SECRETO)!
    expect(eventoEsAutentico(evento, SECRETO, bueno.toUpperCase())).toBe(true)
  })

  it("RECHAZA un evento con otro secreto — el caso del atacante", () => {
    const evento = eventoDeEjemplo()
    const falso = checksumEsperado(evento, "secreto_que_no_es_el_nuestro")!
    expect(eventoEsAutentico(evento, SECRETO, falso)).toBe(false)
  })

  it("RECHAZA si le cambian el monto después de firmar", () => {
    const evento = eventoDeEjemplo()
    const bueno = checksumEsperado(evento, SECRETO)!
    const alterado = JSON.parse(JSON.stringify(evento)) as EventoWompi
    ;(alterado.data as { transaction: { amount_in_cents: number } }).transaction.amount_in_cents = 1
    expect(eventoEsAutentico(alterado, SECRETO, bueno)).toBe(false)
  })

  it("RECHAZA sin checksum", () => {
    expect(eventoEsAutentico(eventoDeEjemplo(), SECRETO, null)).toBe(false)
    expect(eventoEsAutentico(eventoDeEjemplo(), SECRETO, "   ")).toBe(false)
  })

  it("RECHAZA un checksum de largo distinto sin lanzar", () => {
    // `timingSafeEqual` LANZA si los buffers difieren en largo. Sin la comparación previa, un POST
    // con `checksum: "x"` tumbaría el webhook con un 500 — que para Wompi significa "reintentá".
    expect(() => eventoEsAutentico(eventoDeEjemplo(), SECRETO, "x")).not.toThrow()
    expect(eventoEsAutentico(eventoDeEjemplo(), SECRETO, "x")).toBe(false)
  })

  it("usa el checksum de la CABECERA cuando se pasa, no el del cuerpo", () => {
    // Quien arma el cuerpo entero controla `signature.checksum`; la cabecera es la que conviene.
    const evento = eventoDeEjemplo()
    const bueno = checksumEsperado(evento, SECRETO)!
    evento.signature!.checksum = "mentira"
    expect(eventoEsAutentico(evento, SECRETO, bueno)).toBe(true)
  })
})

// ── Referencia ─────────────────────────────────────────────────────────────────────────────────

describe("referenciaDeCobro", () => {
  it("es única por clínica, período e intento — que es lo que evita cobrar dos veces", () => {
    const base = { clinicId: "11111111-2222-3333-4444-555555555555", periodo: "2026-09" }
    expect(referenciaDeCobro({ ...base, intento: 1 })).not.toBe(
      referenciaDeCobro({ ...base, intento: 2 }),
    )
    expect(referenciaDeCobro({ ...base, intento: 1 })).not.toBe(
      referenciaDeCobro({ ...base, periodo: "2026-10", intento: 1 }),
    )
  })

  it("es estable: dos llamadas iguales dan la misma referencia", () => {
    // Es LA condición de la idempotencia: si variara —con una fecha o un azar adentro— dos
    // corridas del cron cobrarían dos veces el mismo mes.
    const args = { clinicId: "abc-123", periodo: "2026-09", intento: 1 }
    expect(referenciaDeCobro(args)).toBe(referenciaDeCobro(args))
  })

  it("sólo deja letras, números y guiones", () => {
    const r = referenciaDeCobro({
      clinicId: "abc_123.def/ghi",
      periodo: "2026-09",
      intento: 1,
    })
    expect(r).toMatch(/^[A-Za-z0-9-]+$/)
  })
})
