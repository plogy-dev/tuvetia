/**
 * Revertir una compra tiene que COMPENSAR, no borrar.
 *
 * `annulPurchaseAction` y `reopenPurchaseAction` hacían `DELETE` de los `inventory_movements` de la
 * compra. En un inventario que es un libro de movimientos eso borra historia, y el stock queda mal
 * en cuanto algo ya se vendió: comprar 10 → confirmar → facturar 8 → reabrir → desaparecen las
 * entradas → stock −8, sin rastro de que existieron.
 *
 * Estos tests trabajan sobre `stockFromMovements`, que es la función que de verdad calcula la
 * existencia, para fijar la propiedad que importa: el saldo después de revertir tiene que ser el
 * mismo que antes de comprar, y la historia tiene que seguir ahí.
 */
import { describe, expect, it } from "vitest"

import { stockFromMovements } from "@/lib/facturacion/domain/inventory"

type Mov = { qty: number; type: Parameters<typeof stockFromMovements>[0][number]["type"] }

const compra = (qty: number): Mov => ({ qty, type: "ENTRADA_COMPRA" })
const venta = (qty: number): Mov => ({ qty: -qty, type: "SALIDA_VENTA" })
/** Lo que ahora inserta `compensarMovimientosDeCompra`: el inverso, como AJUSTE. */
const reverso = (qty: number): Mov => ({ qty: -qty, type: "AJUSTE" })

describe("revertir una compra", () => {
  it("deja el stock donde estaba, y los movimientos originales siguen existiendo", () => {
    const historia: Mov[] = [compra(10)]
    expect(stockFromMovements(historia)).toBe(10)

    historia.push(reverso(10))
    expect(stockFromMovements(historia)).toBe(0)
    // Lo que el DELETE se llevaba: la entrada original sigue en el libro.
    expect(historia.filter((m) => m.type === "ENTRADA_COMPRA")).toHaveLength(1)
  })

  it("el caso que dejaba stock NEGATIVO: reabrir con parte ya vendida", () => {
    // Comprar 10, confirmar, facturar 8, reabrir.
    const historia: Mov[] = [compra(10), venta(8)]
    expect(stockFromMovements(historia)).toBe(2)

    historia.push(reverso(10))
    // Con el DELETE quedaba sólo la venta: −8. Con la compensación, −8 es el saldo REAL de un
    // inventario al que le sacaron 8 unidades que ya no tiene respaldo de compra — y se ve por qué.
    expect(stockFromMovements(historia)).toBe(-8)
    expect(historia).toHaveLength(3)
  })

  it("re-confirmar después de reabrir no duplica el stock", () => {
    // Reabrir compensa; re-confirmar inserta una entrada nueva con los valores editados.
    const historia: Mov[] = [compra(10), reverso(10), compra(12)]
    expect(stockFromMovements(historia)).toBe(12)
  })

  it("anular después de reabrir y re-confirmar NO resta dos veces", () => {
    // Éste es el caso que hizo cambiar la implementación. Compensar cada movimiento por separado
    // parece equivalente y no lo es: la entrada de 10 ya venía compensada por la reapertura, así que
    // volver a restarla dejaba el stock en −10. Se compensa el NETO (aquí, 12), no cada fila.
    const historia: Mov[] = [compra(10), reverso(10), compra(12)]
    const neto = historia.reduce((s, m) => s + m.qty, 0)
    expect(neto).toBe(12)

    historia.push(reverso(neto))
    expect(stockFromMovements(historia)).toBe(0)
  })

  it("compensar una compra ya revertida no hace nada", () => {
    // Con el neto, la idempotencia sale gratis: si ya está saldado no hay nada que insertar — y
    // además `inventory_movements` tiene un CHECK de qty <> 0 que rechazaría el intento.
    const yaCompensada: Mov[] = [compra(10), reverso(10)]
    expect(yaCompensada.reduce((s, m) => s + m.qty, 0)).toBe(0)
  })

  it("un AJUSTE puede ser negativo — por eso es el tipo elegido", () => {
    // `validateMovementSign` exige que ENTRADA_* sea positivo y SALIDA_* negativo; AJUSTE es el
    // único que admite cualquier signo, y una compensación de una entrada es negativa.
    expect(() => stockFromMovements([reverso(5)])).not.toThrow()
    expect(() => stockFromMovements([{ qty: -5, type: "ENTRADA_COMPRA" }])).toThrow(/positivo/)
  })
})
