/**
 * El cronómetro de la consulta.
 *
 * LO QUE ESTOS TESTS PROTEGEN es que el número siga leyéndose como un reloj cuando la consulta se
 * pasa de la hora. Estaba escrito cuatro veces —notch, cockpit, grabador y reproductor— y las
 * cuatro con minutos sin tope: a la hora y media mostraban `88:29`, que no se lee como tiempo sino
 * como un error de render. Salió en una captura el 21-ago.
 *
 * Y no es un caso raro: desde que la sesión sobrevive la navegación, una grabación que quedó
 * abierta pasa de una hora sola. Justo ahí el número tiene que ser legible, porque es la señal de
 * "esto lleva demasiado rato".
 */

import { describe, expect, it } from "vitest"

import { comoReloj } from "@/lib/duracion"

describe("bajo la hora se ve igual que siempre", () => {
  it("arranca en 00:00", () => {
    expect(comoReloj(0)).toBe("00:00")
  })

  it("rellena minutos y segundos a dos cifras", () => {
    expect(comoReloj(5)).toBe("00:05")
    expect(comoReloj(75)).toBe("01:15")
    expect(comoReloj(600)).toBe("10:00")
  })

  it("el último segundo antes de la hora sigue en MM:SS", () => {
    expect(comoReloj(3599)).toBe("59:59")
  })
})

describe("pasada la hora, deja de mentir", () => {
  // EL BUG. Antes esto daba "88:29".
  it("una hora y media es 1:28:29, no 88:29", () => {
    expect(comoReloj(88 * 60 + 29)).toBe("1:28:29")
  })

  it("la hora en punto", () => {
    expect(comoReloj(3600)).toBe("1:00:00")
  })

  it("las horas NO se rellenan con cero, los minutos sí", () => {
    expect(comoReloj(3661)).toBe("1:01:01")
    expect(comoReloj(36000)).toBe("10:00:00")
  })
})

describe("entrada sucia", () => {
  // `NaN:NaN` en la cara del vet parece la app rota; un cero es mentira sólo por un instante.
  it("NaN, Infinity y nulos caen a 00:00", () => {
    expect(comoReloj(Number.NaN)).toBe("00:00")
    expect(comoReloj(Number.POSITIVE_INFINITY)).toBe("00:00")
    expect(comoReloj(null)).toBe("00:00")
    expect(comoReloj(undefined)).toBe("00:00")
  })

  it("un negativo no produce un reloj al revés", () => {
    expect(comoReloj(-30)).toBe("00:00")
  })

  // El `duration` de un <audio> llega con decimales.
  it("los decimales se truncan, no se redondean para arriba", () => {
    expect(comoReloj(59.9)).toBe("00:59")
  })
})
