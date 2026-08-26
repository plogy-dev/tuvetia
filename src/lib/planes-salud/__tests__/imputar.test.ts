/**
 * La imputación al plan al emitir: qué consume cupo y qué no.
 *
 * ── LA REGLA QUE ESTE ARCHIVO CUIDA ───────────────────────────────────────────────────────────
 *
 * Se imputa LO QUE SE COBRÓ EN CERO. El aviso del carrito le dice al vet «lo cubre el plan»; si él
 * imputa, deja la línea en $0 — y esta función lee esa decisión de vuelta. Los dos errores
 * posibles son caros en direcciones opuestas:
 *
 *   · consumir cupo de una línea COBRADA = el titular paga dos veces (en plata y en usos);
 *   · no consumir la línea en cero = el plan nunca se agota y la clínica regala de más.
 */
import { describe, expect, it } from "vitest"

import { usosAImputar } from "@/lib/planes-salud/imputar"

const COBERTURA = [
  { catalogItemId: "consulta", restantes: 2 },
  { catalogItemId: "vacuna", restantes: 1 },
]

describe("usosAImputar", () => {
  it("la línea cubierta y en $0 consume", () => {
    expect(
      usosAImputar([{ catalog_item_id: "consulta", qty: 1, total_cents: 0 }], COBERTURA),
    ).toEqual([{ catalogItemId: "consulta", qty: 1, recortado: false }])
  })

  it("la línea cubierta pero COBRADA no toca el cupo", () => {
    // El titular pagó por fuera del plan: cobrarle también los usos sería cobrar dos veces.
    expect(
      usosAImputar([{ catalog_item_id: "consulta", qty: 1, total_cents: 8000000 }], COBERTURA),
    ).toEqual([])
  })

  it("pide más de lo que queda: imputa lo que queda y lo marca recortado", () => {
    // El trigger de la base RECHAZARÍA el insert entero; recortar acá convierte «se pierden los
    // dos» en «se imputan 2 y se avisa».
    expect(
      usosAImputar([{ catalog_item_id: "consulta", qty: 3, total_cents: 0 }], COBERTURA),
    ).toEqual([{ catalogItemId: "consulta", qty: 2, recortado: true }])
  })

  it("dos líneas del mismo servicio comparten el restante, no lo leen dos veces", () => {
    // Sin descontar entre líneas, dos líneas de 2 con restante 2 imputarían 4 y el trigger
    // tumbaría el segundo insert.
    expect(
      usosAImputar(
        [
          { catalog_item_id: "consulta", qty: 1, total_cents: 0 },
          { catalog_item_id: "consulta", qty: 2, total_cents: 0 },
        ],
        COBERTURA,
      ),
    ).toEqual([
      { catalogItemId: "consulta", qty: 1, recortado: false },
      { catalogItemId: "consulta", qty: 1, recortado: true },
    ])
  })

  it("lo no cubierto y las líneas libres pasan de largo", () => {
    expect(
      usosAImputar(
        [
          { catalog_item_id: "cirugia", qty: 1, total_cents: 0 },
          { catalog_item_id: null, qty: 1, total_cents: 0 },
        ],
        COBERTURA,
      ),
    ).toEqual([])
  })

  it("con el cupo agotado no imputa nada", () => {
    expect(
      usosAImputar(
        [{ catalog_item_id: "vacuna", qty: 1, total_cents: 0 }],
        [{ catalogItemId: "vacuna", restantes: 0 }],
      ),
    ).toEqual([])
  })
})
