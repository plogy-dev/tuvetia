/**
 * Lo recetado, propuesto como renglones de la factura.
 *
 * LO QUE ESTOS TESTS PROTEGEN es de qué lado se erra. Son dos errores posibles y no cuestan lo
 * mismo:
 *
 *   · **Proponer de más** → el vet borra una línea. Un clic.
 *   · **Proponer de menos** → no se cobra algo que se hizo. Plata que no vuelve, y nadie se entera.
 *
 * Por eso ante la duda el renglón se propone, y por eso lo que no calza con el catálogo sale igual
 * como línea libre en vez de descartarse.
 *
 * Y hay un tercer error que estos tests impiden directamente: **deducir cantidades de la
 * posología**. "1 comprimido cada 8h por 5 días" son 15, y calcularlo es tentador — pero si el
 * cálculo falla, falla en la factura de un cliente, y un número que ya viene puesto y parece
 * razonable no lo revisa nadie.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  hayAlgoQueCobrar,
  renglonesDelPlan,
  sugerirRenglones,
  type ItemDeCatalogo,
} from "@/lib/facturacion/lo-recetado"

const CATALOGO: ItemDeCatalogo[] = [
  { id: "consulta", name: "Consulta general", price_cents: 6000000, tax_rate: 0 },
  { id: "metoclo", name: "Metoclopramida 10mg", price_cents: 1200000, tax_rate: 19 },
  { id: "vacuna", name: "Vacuna triple felina", price_cents: 8500000, tax_rate: 0 },
]

describe("qué líneas del plan son cobrables", () => {
  it("saca las viñetas y la numeración", () => {
    const r = renglonesDelPlan("- Metoclopramida 10mg\n• Vacuna triple felina\n1. Consulta general")
    expect(r).toEqual(["Metoclopramida 10mg", "Vacuna triple felina", "Consulta general"])
  })

  it("descarta lo que es instrucción y no cobro", () => {
    // Un plan mezcla lo que se factura con lo que se le dice al dueño. Proponer "reposo" como
    // renglón hace que el vet borre más de lo que agrega — y una herramienta que da más trabajo
    // del que ahorra se deja de usar.
    const r = renglonesDelPlan(
      "- Metoclopramida 10mg\n- Reposo 48 horas\n- Control en 7 días\n- Dieta blanda 3 días",
    )
    expect(r).toEqual(["Metoclopramida 10mg"])
  })

  it("ante la duda, PROPONE", () => {
    // La lista de descartes es corta a propósito. Borrar una línea de más cuesta un clic; olvidar
    // cobrar algo cuesta plata. Esa asimetría decide de qué lado errar.
    const r = renglonesDelPlan("- Aplicación de suero subcutáneo\n- Radiografía de tórax")
    expect(r).toHaveLength(2)
  })

  it("ignora líneas vacías, sueltas o kilométricas", () => {
    const r = renglonesDelPlan(`
      - ok

      -
      - ${"x".repeat(200)}
    `)
    expect(r).toEqual([])
  })

  it("sin plan, nada", () => {
    expect(renglonesDelPlan(null)).toEqual([])
    expect(renglonesDelPlan(undefined)).toEqual([])
    expect(renglonesDelPlan("")).toEqual([])
  })
})

describe("cruzar con el catálogo", () => {
  it("lo que calza viaja con su precio y su IVA", () => {
    const [r] = sugerirRenglones("- Metoclopramida 10mg", CATALOGO)
    expect(r.catalogItemId).toBe("metoclo")
    expect(r.unitPriceCents).toBe(1200000)
    expect(r.taxRate).toBe(19)
  })

  it("lo que NO calza viaja igual, como línea libre en cero", () => {
    // NUNCA se descarta una línea por no encontrarla. El vet tiene que ver todo lo que se recetó,
    // y decidir él — no un umbral de similitud.
    const [r] = sugerirRenglones("- Ozonoterapia sesión 1", CATALOGO)
    expect(r.descripcion).toBe("Ozonoterapia sesión 1")
    expect(r.catalogItemId).toBeNull()
    expect(r.unitPriceCents).toBe(0)
  })

  it("no inventa precios", () => {
    // Adivinar cuánto vale algo es peor que dejarlo en blanco: un cero se ve, un precio inventado
    // se factura.
    for (const r of sugerirRenglones("- Algo que no existe\n- Otra cosa rara", CATALOGO)) {
      expect(r.unitPriceCents).toBe(0)
      expect(r.taxRate).toBe(0)
    }
  })

  it("conserva el texto del plan, no el nombre del catálogo", () => {
    // Es lo que el vet reconoce. Si el renglón dijera "Metoclopramida 10mg" del catálogo cuando él
    // escribió "metoclopramida 0.5 mg/kg", tendría que traducir de vuelta para saber si es lo suyo.
    const [r] = sugerirRenglones("- metoclopramida", CATALOGO)
    expect(r.descripcion).toBe("metoclopramida")
    expect(r.catalogItemId).toBe("metoclo")
  })

  it("con el catálogo vacío no revienta: todo sale libre", () => {
    const rs = sugerirRenglones("- Consulta general\n- Vacuna triple felina", [])
    expect(rs).toHaveLength(2)
    expect(rs.every((r) => r.catalogItemId === null)).toBe(true)
  })
})

describe("lo que NO se deduce", () => {
  it("una posología no se convierte en cantidad", () => {
    // "1 comprimido cada 8 horas por 5 días" son 15 comprimidos. NO se calcula, y las razones se
    // suman: la presentación que se vende casi nunca es la unidad que se administra, puede que ya
    // se lo hayan llevado, y si el cálculo falla, falla en la factura de un cliente.
    //
    // El renglón sale con lo que se escribió y CANTIDAD 1. El vet ajusta.
    const [r] = sugerirRenglones("- Metoclopramida 10mg, 1 comprimido cada 8h por 5 días", CATALOGO)
    expect(r).not.toHaveProperty("qty")
    expect(r).not.toHaveProperty("cantidad")
    // Y la descripción llega entera, con la posología adentro: es el dato que el vet necesita para
    // decidir cuántas unidades cobrar.
    expect(r.descripcion).toContain("cada 8h por 5 días")
  })
})

describe("cuándo vale la pena ofrecerlo", () => {
  it("con renglones, sí", () => {
    expect(hayAlgoQueCobrar("- Consulta general")).toBe(true)
  })

  it("sin renglones cobrables, no", () => {
    // Abrir un carrito vacío es exactamente lo que ya se podía hacer. Ofrecerlo como si fuera una
    // ayuda es ruido.
    expect(hayAlgoQueCobrar("- Reposo 48 horas\n- Control en 7 días")).toBe(false)
    expect(hayAlgoQueCobrar(null)).toBe(false)
  })
})

// ── Que el aviso llegue donde el vet está, y que el carrito no arranque vacío ───────────────────

describe("el aviso y el borrador", () => {
  const leer = (ruta: string) =>
    readFileSync(join(process.cwd(), "src", ruta), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")

  it("la consulta ofrece facturar, y sólo con la nota aprobada", () => {
    // Cobrar a partir de un borrador que nadie firmó sería facturar lo que todavía se puede
    // cambiar. Y sin nada cobrable en el plan no se ofrece: abrir un carrito vacío es lo que ya se
    // podía hacer, y ofrecerlo como ayuda es ruido.
    const consulta = leer("app/dashboard/consultas/[id]/page.tsx")
    expect(consulta).toContain("hayAlgoQueCobrar")
    expect(consulta).toMatch(/approved && hayAlgoQueCobrar/)
    expect(consulta).toContain("consultationId=")
  })

  it("la señal del riel existe y va debajo de las notas sin firmar", () => {
    // El orden del riel es "cuánto duele": facturar tarde cuesta plata, pero una nota sin firmar es
    // una consulta que, a efectos del expediente, no ocurrió.
    const pend = leer("lib/senales/pendientes.ts")
    const iNotas = pend.indexOf('"notas-sin-aprobar",')
    const iFactura = pend.indexOf('"sin-facturar",')
    expect(iFactura).toBeGreaterThan(iNotas)
    expect(pend).toContain("export function sinFacturar")
  })

  it("la nueva factura sólo lee la nota APROBADA", () => {
    const nueva = leer("app/dashboard/facturacion/nueva/page.tsx")
    expect(nueva).toContain("sugerirRenglones")
    expect(nueva).toMatch(/eq\('status', 'approved'\)/)
  })

  it("el carrito siembra en cantidad 1, y las claves no chocan", () => {
    // `nextKey` tiene que arrancar DESPUÉS de las líneas sembradas: si arrancara en 1, la primera
    // línea agregada a mano pisaría la clave de una sembrada y React reusaría la fila equivocada.
    const cart = leer("components/facturacion/InvoiceCart.tsx")
    expect(cart).toMatch(/qty:\s*1,/)
    expect(cart).toMatch(/useState\(\(renglonesIniciales\?\.length \?\? 0\) \+ 1\)/)
  })

  it("no se reimplementa el matcher de nombres", () => {
    // `matchComponentName` ya resuelve texto libre contra catálogo para las recetas de inventario,
    // con el mismo problema y mejor probado de lo que estaría una segunda copia.
    expect(leer("lib/facturacion/lo-recetado.ts")).toContain("matchComponentName")
  })
})
