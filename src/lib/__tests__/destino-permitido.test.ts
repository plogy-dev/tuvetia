/**
 * A quién puede escribirle la clínica por WhatsApp.
 *
 * LO QUE ESTOS TESTS PROTEGEN son las dos mitades de una guarda, que fallan en direcciones
 * opuestas y las dos duelen:
 *
 *   · SI DEJA PASAR DE MÁS → Athos le escribe a gente que no tiene nada que ver con la clínica.
 *     Felipe lo vivió: *"le metí una gente en su WhatsApp y empezó a escribir a la loca, casi me
 *     despiden"*. Medido contra el principal el 22-ago: **273 mensajes a 29 números** que no eran
 *     titulares, nunca escribieron y no llevaban `owner_id`.
 *
 *   · SI BLOQUEA DE MÁS → una veterinaria no puede responderle a su propio cliente. Eso no es una
 *     molestia, es el producto roto: "sólo titulares" habría bloqueado **3.426 de 3.472** salientes
 *     históricos, porque el grueso del tráfico legítimo es responderle a quien escribió primero y
 *     todavía no está cargado.
 *
 * El caso que más importa acá es el de los FORMATOS: el mismo número vive escrito de cuatro maneras
 * —`+57 324 466 9300`, `3244669300`, `573244669300`— y si la comparación fuera exacta, la guarda
 * bloquearía titulares reales por un espacio.
 */

import { describe, expect, it } from "vitest"

import { claveDeTelefono, esDestinoConocido } from "@/lib/whatsapp/destino-permitido"

describe("la clave con la que se comparan los teléfonos", () => {
  it("son los últimos 10 dígitos", () => {
    expect(claveDeTelefono("573244669300")).toBe("3244669300")
    expect(claveDeTelefono("3244669300")).toBe("3244669300")
  })

  // 36 de los 41 titulares del principal tienen el teléfono con formato.
  it("ignora espacios, signos y paréntesis", () => {
    expect(claveDeTelefono("+57 324 466 9300")).toBe("3244669300")
    expect(claveDeTelefono("(324) 466-9300")).toBe("3244669300")
  })

  // Un teléfono basura no puede abrir la puerta por coincidir con otro basura.
  it("lo que no tiene 10 dígitos no es una clave", () => {
    expect(claveDeTelefono("123")).toBe("")
    expect(claveDeTelefono("")).toBe("")
    expect(claveDeTelefono(null)).toBe("")
    expect(claveDeTelefono(undefined)).toBe("")
  })
})

describe("quién pasa la guarda", () => {
  const TITULARES = ["+57 324 466 9300", "3105551234", "573001112233"]

  // EL CASO QUE MÁS DUELE SI FALLA: el mismo número escrito distinto en los dos lados.
  it("un titular pasa aunque esté guardado con otro formato", () => {
    expect(esDestinoConocido("573244669300", TITULARES)).toBe(true)
    expect(esDestinoConocido("3244669300", TITULARES)).toBe(true)
    expect(esDestinoConocido("+57 324 466 9300", TITULARES)).toBe(true)
  })

  it("los tres formatos de la lista se reconocen igual", () => {
    expect(esDestinoConocido("573105551234", TITULARES)).toBe(true)
    expect(esDestinoConocido("573001112233", TITULARES)).toBe(true)
  })

  // EL CASO QUE MÁS DUELE SI PASA: el número que Athos se inventó.
  it("un desconocido NO pasa", () => {
    expect(esDestinoConocido("573009998877", TITULARES)).toBe(false)
  })

  it("sin nadie registrado, nadie pasa", () => {
    expect(esDestinoConocido("573244669300", [])).toBe(false)
  })

  // Un `phone` vacío en la base no puede volverse un comodín que deje pasar cualquier cosa.
  it("un teléfono vacío en la lista no habilita a nadie", () => {
    expect(esDestinoConocido("573244669300", ["", "   ", null as unknown as string])).toBe(false)
  })

  it("un destino sin dígitos suficientes no pasa aunque la lista tenga basura igual", () => {
    expect(esDestinoConocido("123", ["123"])).toBe(false)
  })

  // No alcanza con que el número CONTENGA la clave: tiene que terminar en ella. Si no, un número
  // largo cualquiera que incluyera esos dígitos en el medio pasaría.
  it("compara por el final, no por 'contiene'", () => {
    expect(esDestinoConocido("3244669300", ["3244669300999"])).toBe(false)
  })
})
