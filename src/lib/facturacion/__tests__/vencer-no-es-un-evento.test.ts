/**
 * La insignia de una factura y el tramo de antigüedad no pueden decir cosas distintas.
 *
 * ── EL DEFECTO, encontrado en la auditoría del 27-ago ──────────────────────────────────────────
 *
 * `deriveStatus` calcula `VENCIDA` bien, pero sólo corre cuando pasa un EVENTO: un pago, una nota
 * crédito, una promesa. **Vencer no es un evento** — es que se acabó un plazo mientras nadie tocaba
 * nada. Así que `invoices.collection_status` se quedaba en `PENDIENTE` para siempre, y el
 * planificador de cartera tampoco la despertaba: sólo refresca las que están en promesa de pago, y
 * sólo mira facturas con seguimiento activo.
 *
 * En la pantalla de Cartera se veía así, en la MISMA FILA:
 *
 *     KPI «Cartera vencida»  →  $ 317.620      (calculado al leer, contra `due_date`)
 *     insignia de la fila    →  «Pendiente de pago»   (leída de la columna)
 *
 * SPOS-2 llevaba once días vencida y SPOS-4 seis. Y le pasaba delante del cliente, que estaba
 * revisando el módulo.
 *
 * ── LO QUE FIJA ESTE ARCHIVO ───────────────────────────────────────────────────────────────────
 *
 * Que las dos cosas salgan del MISMO reloj. `estadoDeCobroVisible` usa `daysOverdue`, que es la
 * función que ya alimenta a `computeAging`; el test de abajo lo comprueba por comportamiento y no
 * leyendo el código: arma una cartera, cuenta cuántas marca cada uno, y exige que coincidan.
 * Mientras ese test esté, no pueden separarse aunque alguien reescriba las dos funciones.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { computeAging } from "@/lib/facturacion/domain/aging"
import { estadoDeCobroVisible } from "@/lib/facturacion/domain/invoice-status"
import type { CollectionStatus } from "@/lib/facturacion/domain/types"

/** 27 de agosto de 2026, media tarde en Bogotá. */
const AHORA = new Date("2026-08-27T18:00:00Z")
const dia = (iso: string) => iso

describe("una factura vencida se ve vencida sin que pase nada", () => {
  it("PENDIENTE con el plazo cumplido se muestra VENCIDA", () => {
    // Es el caso real de SPOS-2: venció el 16 de agosto y la columna seguía en PENDIENTE.
    expect(
      estadoDeCobroVisible("PENDIENTE", { dueDate: dia("2026-08-16"), balanceCents: 20_662_00 }, AHORA),
    ).toBe("VENCIDA")
  })

  it("PARCIALMENTE_PAGADA también asciende: un abono no reinicia el plazo", () => {
    expect(
      estadoDeCobroVisible("PARCIALMENTE_PAGADA", { dueDate: dia("2026-08-21"), balanceCents: 50_000_00 }, AHORA),
    ).toBe("VENCIDA")
  })

  it("vencer HOY todavía no es estar vencida", () => {
    // Misma regla que `daysOverdue`: el día del vencimiento se cuenta completo. Cobrarle a alguien
    // por la mañana del día que vence sería cobrarle antes de tiempo.
    expect(
      estadoDeCobroVisible("PENDIENTE", { dueDate: dia("2026-08-27"), balanceCents: 100_00 }, AHORA),
    ).toBe("PENDIENTE")
  })

  it("una factura sin fecha de vencimiento no vence", () => {
    expect(
      estadoDeCobroVisible("PENDIENTE", { dueDate: null, balanceCents: 100_00 }, AHORA),
    ).toBe("PENDIENTE")
  })

  it("sin saldo no hay nada que vencer", () => {
    // El saldo llega a cero antes de que el estado guardado se actualice: no se puede anunciar como
    // vencida una factura que ya está paga.
    expect(
      estadoDeCobroVisible("PENDIENTE", { dueDate: dia("2026-01-01"), balanceCents: 0 }, AHORA),
    ).toBe("PENDIENTE")
  })
})

describe("asciende, pero nunca pisa un estado que manda más", () => {
  // La precedencia de `deriveStatus` es: castigo > disputa > pagada > promesa vigente > VENCIDA >
  // parcial > pendiente. Acá se respeta al pie — sobre todo la promesa, que existe justamente para
  // que la factura NO se trate como vencida mientras el cliente cumpla la fecha que prometió.
  const intocables: CollectionStatus[] = ["CASTIGADA", "EN_DISPUTA", "PAGADA", "EN_PROMESA_DE_PAGO"]

  it.each(intocables)("%s se queda como está aunque el plazo esté cumplido", (estado) => {
    expect(
      estadoDeCobroVisible(estado, { dueDate: dia("2026-01-01"), balanceCents: 500_000_00 }, AHORA),
    ).toBe(estado)
  })

  it("una que ya estaba VENCIDA no cambia", () => {
    expect(
      estadoDeCobroVisible("VENCIDA", { dueDate: dia("2026-08-16"), balanceCents: 100_00 }, AHORA),
    ).toBe("VENCIDA")
  })
})

describe("la insignia y el tramo de antigüedad cuentan lo mismo", () => {
  /**
   * ESTE ES EL CERROJO QUE IMPORTA, y por eso es de comportamiento y no de texto.
   *
   * El defecto no fue que una de las dos estuviera mal: fue que cada una respondía a una fuente
   * distinta —la columna guardada contra el cálculo en vivo— y nadie las comparaba. Acá se arma una
   * cartera con vencimientos repartidos y se exige que el número de facturas que `computeAging`
   * mete en un tramo vencido sea EXACTAMENTE el número que la insignia muestra como «Vencida».
   *
   * Si alguien vuelve a leer la columna en una de las dos pantallas, o cambia el criterio de días
   * en una sola, este test lo dice.
   */
  const cartera = [
    { dueDate: "2026-05-01", balanceCents: 10_000_00 }, // 118 días
    { dueDate: "2026-06-20", balanceCents: 20_000_00 }, //  68 días
    { dueDate: "2026-07-20", balanceCents: 30_000_00 }, //  38 días
    { dueDate: "2026-08-16", balanceCents: 20_662_00 }, //  11 días — SPOS-2
    { dueDate: "2026-08-21", balanceCents: 11_100_00 }, //   6 días — SPOS-4
    { dueDate: "2026-08-27", balanceCents: 13_708_80 }, //   hoy: NO vencida
    { dueDate: "2026-09-17", balanceCents: 16_700_00 }, //   futura
    { dueDate: null, balanceCents: 5_000_00 }, //             sin fecha
  ]

  it("el mismo número de facturas, contado de las dos maneras", () => {
    const aging = computeAging(cartera, AHORA)
    const enTramosVencidos =
      aging.d1_30.count + aging.d31_60.count + aging.d61_90.count + aging.d90plus.count

    const conInsigniaVencida = cartera.filter(
      (f) => estadoDeCobroVisible("PENDIENTE", f, AHORA) === "VENCIDA",
    ).length

    expect(conInsigniaVencida).toBe(enTramosVencidos)
    expect(enTramosVencidos).toBe(5) // las cinco de arriba con días > 0
  })

  it("y la misma plata", () => {
    const aging = computeAging(cartera, AHORA)
    const sumaPorInsignia = cartera
      .filter((f) => estadoDeCobroVisible("PENDIENTE", f, AHORA) === "VENCIDA")
      .reduce((a, f) => a + f.balanceCents, 0)

    // El KPI «Cartera vencida» sale de `totalOverdueCents`. Si difiere de lo que las insignias
    // marcan, la pantalla vuelve a contradecirse — que es el defecto exacto que esto cierra.
    expect(sumaPorInsignia).toBe(aging.totalOverdueCents)
  })
})

describe("ninguna pantalla vuelve a pintar la columna cruda", () => {
  // El arreglo son tres sitios y basta con que uno se revierta para que la contradicción vuelva —
  // en esa pantalla y sólo en esa, que es la forma más difícil de notarla. Las tres se comprueban
  // igual: si aparece `collection_status` dentro de un `<CollectionBadge`, es la columna sin derivar.
  const PANTALLAS = [
    ["Cartera", "src/app/dashboard/facturacion/cartera/page.tsx"],
    ["el libro de ventas", "src/app/dashboard/facturacion/page.tsx"],
    ["el detalle de la factura", "src/app/dashboard/facturacion/[id]/page.tsx"],
  ] as const

  it.each(PANTALLAS)("%s deriva el estado en vez de leerlo", (_nombre, ruta) => {
    const texto = readFileSync(join(process.cwd(), ruta), "utf8")
    // Ventana amplia: la insignia derivada ocupa varias líneas, y quedarse corto haría que el
    // test no encontrara nada y pasara en verde sin comprobar — el modo de fallo del cerrojo del
    // ámbar, que comparaba una cadena y no el efecto.
    const insignias = [...texto.matchAll(/<CollectionBadge[\s\S]{0,400}?\/>/g)].map((m) => m[0])
    expect(insignias.length, `${ruta} no pinta ninguna insignia de recaudo`).toBeGreaterThan(0)
    for (const i of insignias) {
      expect(i, `${ruta} pinta la columna guardada: vencer no es un evento y nadie la actualiza`)
        .toMatch(/estadoDeCobroVisible\(/)
    }
  })
})
