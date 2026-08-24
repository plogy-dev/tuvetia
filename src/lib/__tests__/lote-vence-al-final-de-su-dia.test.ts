/**
 * Un lote vale hasta el FINAL de su día de vencimiento.
 *
 * ── EL DEFECTO ──────────────────────────────────────────────────────────────────────────────────
 *
 * `catalog_lots.expires_on` es una columna DATE: PostgREST la entrega como `"2027-01-15"`, y la
 * forma ISO sólo-fecha **se parsea siempre en UTC, por spec**. `getNearExpirySet` hacía
 * `new Date(lot.expires_on)`, así que en Bogotá ese instante es el **14 a las 19:00** — el lote se
 * daba por vencido cinco horas antes de que terminara su día.
 *
 * Es el MISMO defecto que ya se había corregido para `due_date` —hay un archivo entero sobre él,
 * `vencimiento-zona.test.ts`, que explica el borde— y a `expires_on` nunca le llegó.
 *
 * ── POR QUÉ ESTOS TESTS FIJAN UNA HORA CONCRETA ─────────────────────────────────────────────────
 *
 * Porque el defecto SÓLO aparece entre las 19:00 y la medianoche de Bogotá. Un test que use
 * `new Date()` a media tarde pasa igual con el código roto — que es exactamente por qué esto
 * sobrevivió: nadie lo ve probando a mano en horario de oficina.
 *
 * Sobre una ventana de 30 días las cinco horas casi nunca cambian la respuesta. Cuando la cambian,
 * la cambian **en el borde** — el día en que alguien mira la alerta.
 */

import { describe, expect, it } from "vitest"

import { finDelDiaBogota } from "@/lib/date-utils"
import { lotNearExpiry } from "@/lib/facturacion/domain/inventory"

// 20:00 del 15 de agosto en Bogotá. En UTC ya es el 16 — ése es el borde que rompe todo.
const NOCHE_DEL_15 = new Date("2026-08-15T20:00:00-05:00")

describe("el corte del día", () => {
  it("una fecha sólo-día se parsea en UTC, que es de donde salía el defecto", () => {
    // La premisa. Si algún día esto cambiara, medio archivo dejaría de tener sentido.
    expect(new Date("2026-08-15").toISOString()).toBe("2026-08-15T00:00:00.000Z")
    // …y en Bogotá eso es el 14 a las 19:00.
    expect(new Date("2026-08-15").getTime()).toBeLessThan(
      new Date("2026-08-15T00:00:00-05:00").getTime(),
    )
  })

  it("finDelDiaBogota devuelve el instante en que el día se acaba", () => {
    // Medianoche del 16 en Bogotá = 05:00 UTC del 16.
    expect(finDelDiaBogota("2026-08-15")!.toISOString()).toBe("2026-08-16T05:00:00.000Z")
  })
})

describe("un lote que vence HOY sigue siendo bueno hoy", () => {
  // EL TEST QUE ATRAPA EL BUG. Con `new Date("2026-08-15")` el lote "vence" el 14 a las 19:00, así
  // que a las 20:00 del 15 ya figuraba vencido —diferencia de 25 horas— y la ventana de 30 días lo
  // marcaba igual, pero el signo del cálculo pasaba a ser negativo: el lote deja de estar "por
  // vencer" y pasa a estar "vencido", que es otra cosa en la pantalla.
  it("a las 20:00 de su propio día todavía no se agotó", () => {
    const vence = finDelDiaBogota("2026-08-15")!
    expect(vence.getTime() > NOCHE_DEL_15.getTime()).toBe(true)
  })

  it("con el parseo viejo ya se había agotado — y por eso el arreglo", () => {
    const viejo = new Date("2026-08-15")
    expect(viejo.getTime() > NOCHE_DEL_15.getTime()).toBe(false)
  })

  it("al día siguiente sí se agotó", () => {
    const vence = finDelDiaBogota("2026-08-15")!
    const manana = new Date("2026-08-16T08:00:00-05:00")
    expect(vence.getTime() > manana.getTime()).toBe(false)
  })
})

describe("la alerta de por vencer, con el corte bueno", () => {
  it("un lote a 10 días entra en la ventana de 30", () => {
    expect(lotNearExpiry(finDelDiaBogota("2026-08-25"), NOCHE_DEL_15, 30)).toBe(true)
  })

  it("uno a 60 días no", () => {
    expect(lotNearExpiry(finDelDiaBogota("2026-10-14"), NOCHE_DEL_15, 30)).toBe(false)
  })

  // `finDelDiaBogota` devuelve null con una fecha inválida, y `lotNearExpiry` ya trata null como
  // "sin vencimiento". Los dos lados coinciden, así que una fila con basura no alerta en vez de
  // reventar la pantalla de inventario.
  it("una fecha inválida no alerta ni rompe", () => {
    expect(finDelDiaBogota("")).toBeNull()
    expect(lotNearExpiry(finDelDiaBogota(""), NOCHE_DEL_15, 30)).toBe(false)
  })
})

describe("y el cableado, que es lo que los tests de arriba NO cubren", () => {
  // Los de arriba ejercitan los dos helpers y pasarían igual si alguien volviera a poner
  // `new Date(lot.expires_on)` en la query. Esta es la mitad que ata el arreglo a su sitio.
  it("getNearExpirySet usa finDelDiaBogota y no new Date sobre expires_on", async () => {
    const { readFileSync } = await import("node:fs")
    const fuente = readFileSync("src/lib/facturacion/queries.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")

    expect(fuente).toMatch(/lotNearExpiry\(\s*finDelDiaBogota\(/)
    expect(
      fuente,
      "volvió el `new Date(lot.expires_on)`: una columna DATE se parsea en UTC y el lote se da " +
        "por vencido cinco horas antes de que termine su día",
    ).not.toMatch(/new Date\(lot\.expires_on\)/)
  })
})
