/**
 * El cumplimiento de la meta del mes.
 *
 * Lo que se fija acá es que el anillo NO MIENTA: que superar la meta no se vea igual que ir corto,
 * que no haya meta y haber vendido cero sean estados distintos, y que el juicio de «voy bien» se
 * haga contra el día del mes y no contra un número suelto.
 */
import { describe, expect, it } from "vitest"

import { cumplimiento } from "@/lib/tablero/cumplimiento"

const META = 10_000_00 // $10.000,00 en centavos

describe("cuando no hay meta", () => {
  it("no devuelve nada, en vez de un cero", () => {
    // Son estados distintos: sin meta el bloque no se pinta. Un «0%» a quien nunca puso una meta le
    // reprocha algo que no eligió.
    expect(cumplimiento(500_00, null)).toBeNull()
    expect(cumplimiento(500_00, undefined)).toBeNull()
    expect(cumplimiento(500_00, 0)).toBeNull()
  })

  it("una meta negativa o rota tampoco se dibuja", () => {
    expect(cumplimiento(500_00, -1)).toBeNull()
    expect(cumplimiento(500_00, Number.NaN)).toBeNull()
  })
})

describe("el porcentaje", () => {
  it("cuenta lo vendido contra la meta", () => {
    expect(cumplimiento(5_000_00, META)!.pct).toBe(50)
    expect(cumplimiento(10_000_00, META)!.pct).toBe(100)
  })

  it("un mes sin ventas es 0%, no null", () => {
    // Acá el cero SÍ se muestra: hay una meta cargada y todavía no se vendió.
    const c = cumplimiento(0, META)!
    expect(c.pct).toBe(0)
    expect(c.cumplida).toBe(false)
  })
})

describe("superar la meta", () => {
  it("el numero pasa de 100 porque es informacion", () => {
    expect(cumplimiento(13_000_00, META)!.pct).toBe(130)
  })

  it("pero el ARCO se queda lleno", () => {
    // Un arco de 130% da la vuelta y a la vista queda igual que un 30%: el mejor mes del año se
    // vería como el peor.
    const c = cumplimiento(13_000_00, META)!
    expect(c.pctDeArco).toBe(100)
    expect(c.cumplida).toBe(true)
  })

  it("y no queda faltando plata en negativo", () => {
    expect(cumplimiento(13_000_00, META)!.faltanCents).toBe(0)
  })
})

describe("lo que falta", () => {
  it("es la diferencia en centavos", () => {
    expect(cumplimiento(4_000_00, META)!.faltanCents).toBe(6_000_00)
  })
})

describe("el ritmo del mes", () => {
  it("sin dia no se juzga, y no se pinta alarma", () => {
    // Un rojo por no saber en qué día estamos sería una alarma inventada.
    const c = cumplimiento(2_000_00, META)!
    expect(c.ritmoPct).toBeNull()
    expect(c.enRitmo).toBeNull()
    expect(c.color).toBe("var(--color-brand)")
  })

  it("el dia cuenta completo", () => {
    // Si el día 1 valiera 0%, todo el mundo estaría «en ritmo» cada día 1.
    expect(cumplimiento(0, META, { dia: 1, dias: 30 })!.ritmoPct).toBe(3)
    expect(cumplimiento(0, META, { dia: 30, dias: 30 })!.ritmoPct).toBe(100)
  })

  it("ir al 60% el dia 18 de 30 es ir en ritmo", () => {
    const c = cumplimiento(6_000_00, META, { dia: 18, dias: 30 })!
    expect(c.enRitmo).toBe(true)
    expect(c.color).toBe("var(--color-brand)")
  })

  it("ir al 40% el dia 28 de 30 no lo es, y avisa en ambar", () => {
    // Ámbar y no rojo: el rojo permanente se vuelve ruido que se deja de mirar.
    const c = cumplimiento(4_000_00, META, { dia: 28, dias: 30 })!
    expect(c.enRitmo).toBe(false)
    expect(c.color).toBe("var(--color-warn)")
  })

  it("superar la meta manda sobre el ritmo", () => {
    const c = cumplimiento(11_000_00, META, { dia: 28, dias: 30 })!
    expect(c.color).toBe("var(--color-ok)")
  })

  it("el ritmo se compara contra el pct REAL, no contra el del arco", () => {
    // Taparlo en 100 antes de comparar dejaría al que va al 130% empatado con el que va justo.
    const c = cumplimiento(13_000_00, META, { dia: 30, dias: 30 })!
    expect(c.enRitmo).toBe(true)
  })

  it("un dia imposible se ignora en vez de romper", () => {
    expect(cumplimiento(0, META, { dia: 0, dias: 30 })!.ritmoPct).toBeNull()
    expect(cumplimiento(0, META, { dia: 31, dias: 30 })!.ritmoPct).toBeNull()
    expect(cumplimiento(0, META, { dia: 5, dias: 0 })!.ritmoPct).toBeNull()
  })
})

describe("los colores", () => {
  it("son tokens y NUNCA hex", () => {
    // Un hex escrito acá es un color que en modo oscuro grita.
    for (const caso of [
      cumplimiento(1_000_00, META, { dia: 28, dias: 30 })!,
      cumplimiento(9_000_00, META, { dia: 5, dias: 30 })!,
      cumplimiento(11_000_00, META)!,
    ]) {
      expect(caso.color).toMatch(/^var\(--/)
    }
  })
})
