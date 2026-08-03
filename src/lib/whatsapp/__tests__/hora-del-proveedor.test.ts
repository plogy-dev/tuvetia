import { describe, expect, it } from "vitest"

import { horaDelProveedor } from "../hora-del-proveedor"
import { extensionDe } from "../media"

// Un `ahora` fijo: la función acepta el reloj por parámetro justamente para que esto no dependa de
// cuándo se corra el test.
const AHORA = Date.parse("2026-08-03T12:00:00Z")

describe("horaDelProveedor", () => {
  it("convierte los segundos que mandan los dos proveedores", () => {
    // WhatsApp manda SEGUNDOS. Confundirlos con milisegundos —el error clásico— pondría el mensaje
    // en 1970 y lo enterraría al principio del hilo.
    expect(horaDelProveedor(1_785_000_000, AHORA)).toBe("2026-07-25T17:20:00.000Z")
  })

  it("acepta el string, que es como a veces llega de Baileys y siempre de Meta", () => {
    expect(horaDelProveedor("1785000000", AHORA)).toBe(horaDelProveedor(1_785_000_000, AHORA))
  })

  it("descarta lo que no es una hora", () => {
    for (const basura of [null, undefined, "", 0, -1, Number.NaN, "hola"]) {
      expect(horaDelProveedor(basura as never, AHORA)).toBeNull()
    }
  })

  it("descarta el futuro lejano, que es lo que clavaría un mensaje arriba del hilo para siempre", () => {
    const dentroDeDosDias = AHORA / 1000 + 2 * 24 * 60 * 60
    expect(horaDelProveedor(dentroDeDosDias, AHORA)).toBeNull()
  })

  it("tolera un reloj algo adelantado: husos y desajustes normales no son basura", () => {
    const dentroDeSeisHoras = AHORA / 1000 + 6 * 60 * 60
    expect(horaDelProveedor(dentroDeSeisHoras, AHORA)).not.toBeNull()
  })

  it("acepta el pasado sin límite: un teléfono que estuvo sin señal manda mensajes viejos DE VERDAD", () => {
    const haceUnAnio = AHORA / 1000 - 365 * 24 * 60 * 60
    expect(horaDelProveedor(haceUnAnio, AHORA)).toBe("2025-08-03T12:00:00.000Z")
  })

  it("ordena igual como string que como fecha — que es como la bandeja lo compara", () => {
    const a = horaDelProveedor(1_785_000_000, AHORA)!
    const b = horaDelProveedor(1_785_000_060, AHORA)!
    expect(a < b).toBe(true)
  })
})

describe("extensionDe", () => {
  it("mapea los mimetypes que manda WhatsApp", () => {
    expect(extensionDe("image/jpeg")).toBe("jpg")
    expect(extensionDe("application/pdf")).toBe("pdf")
  })

  it("ignora los parámetros del mimetype", () => {
    // Las notas de voz llegan SIEMPRE así; sin recortar en el `;` el archivo quedaría con una
    // extensión inventada de varias palabras.
    expect(extensionDe("audio/ogg; codecs=opus")).toBe("ogg")
  })

  it("no se cae con lo desconocido ni deja meter basura en el path", () => {
    expect(extensionDe(null)).toBe("bin")
    expect(extensionDe("application/x-cosa-rara")).toBe("xcosarara")
    expect(extensionDe("../../etc/passwd")).toBe("bin")
  })
})
