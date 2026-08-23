/**
 * "¿Esto estaba plegado?" — el mecanismo que comparten las superficies que se acuerdan.
 *
 * LO QUE PROTEGE es de qué lado se erra al leer un valor guardado, que es la única decisión de peso
 * que hay acá:
 *
 *   · ARRANCAR ABIERTO CUANDO NO CORRESPONDÍA → el vet cierra el panel otra vez. Un clic.
 *   · ARRANCAR PLEGADO CUANDO NO CORRESPONDÍA → una función desapareció sin explicación, y el vet
 *     no tiene cómo recuperarla salvo limpiar el navegador.
 *
 * Por eso sólo el `"1"` exacto significa plegado. `localStorage` devuelve `string | null` y ahí
 * adentro puede haber cualquier cosa: una versión vieja del valor, algo que escribió otra pestaña,
 * o basura de una extensión.
 */

import { describe, expect, it } from "vitest"

import { estaPlegado, preferenciaPlegada, valorAGuardar } from "@/lib/ui/preferencia-plegada"

describe("qué crudo significa plegado", () => {
  it("lo que se guarda se vuelve a leer igual", () => {
    expect(estaPlegado(valorAGuardar(true))).toBe(true)
    expect(estaPlegado(valorAGuardar(false))).toBe(false)
  })

  // ANTE LA DUDA, ABIERTO. Es la falla barata de las dos.
  it("sin nada guardado, abierto", () => {
    expect(estaPlegado(null)).toBe(false)
    expect(estaPlegado(undefined)).toBe(false)
    expect(estaPlegado("")).toBe(false)
  })

  it("con basura o con un valor de otra versión, abierto", () => {
    expect(estaPlegado("true")).toBe(false)
    expect(estaPlegado("plegado")).toBe(false)
    expect(estaPlegado("{}")).toBe(false)
    // Un `"1"` con espacios NO cuenta: si se aceptara, cualquier cosa que empiece por 1 abriría la
    // puerta a interpretaciones y el valor dejaría de ser un contrato de dos estados.
    expect(estaPlegado(" 1")).toBe(false)
  })
})

describe("cada superficie tiene su propia clave", () => {
  // Dos superficies compartiendo clave se pliegan y despliegan juntas, que es el bug que aparece
  // cuando alguien copia el módulo y se olvida de cambiar la constante.
  it("no se pisan entre sí", () => {
    const a = preferenciaPlegada("tuvetia:uno")
    const b = preferenciaPlegada("tuvetia:dos")
    expect(a.clave).not.toBe(b.clave)
  })

  it("del lado del servidor todas arrancan abiertas", () => {
    expect(preferenciaPlegada("tuvetia:lo-que-sea").enElServidor()).toBe(false)
  })
})
