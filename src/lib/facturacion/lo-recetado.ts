// Lo que se recetó en la consulta, propuesto como renglones de la factura.
//
// LO QUE SE PIDIÓ, el 19-ago: que Athos avise *"tenés esta factura por emitir de esta consulta"* y
// que el borrador venga armado con lo que se recetó.
//
// ── LO QUE YA EXISTÍA, Y NO SE REHACE ───────────────────────────────────────────────────────────
//
// La mitad estaba construida: `getUnbilledConsultations` lista las consultas terminadas sin factura
// y se muestra en Ventas → Nueva factura. Lo que faltaba son dos cosas concretas:
//
//   1. Que **avise** desde donde el vet está, en vez de esperarlo en Ventas.
//   2. Que el carrito **no arranque vacío** cuando ya se sabe qué se recetó.
//
// Esto es lo segundo. La búsqueda por nombre tampoco se reimplementa: `matchComponentName` ya la
// resuelve para las recetas de inventario, con el mismo problema —texto libre contra catálogo— y
// mejor probada de lo que estaría una segunda copia.
//
// ── LO QUE ESTE MÓDULO **NO** HACE, Y ES LO MÁS IMPORTANTE ──────────────────────────────────────
//
// **No deduce cantidades de la posología.** "1 comprimido cada 8 horas por 5 días" son 15
// comprimidos, y la tentación de calcularlo es fuerte. No se hace, por tres razones que se suman:
//
//   · La presentación que se vende casi nunca es la unidad que se administra (una caja de 20).
//   · Puede que ya se lo hayan llevado, o que se le haya aplicado en la consulta y sólo se cobre
//     una dosis.
//   · Si el cálculo falla, falla en la FACTURA de un cliente — y nadie revisa un número que ya
//     viene puesto y parece razonable.
//
// Todo sale en **cantidad 1** y el vet ajusta. Un renglón que hay que corregir se ve; uno que está
// mal y parece bien, no.
//
// **Y no inventa precios.** Lo que no calza con el catálogo sale como línea libre con precio cero:
// el vet le pone el precio o lo borra. Adivinar cuánto vale algo es peor que dejarlo en blanco.
//
// Puro y sin red, como el resto: `vitest.config.mts` corre en `environment: "node"`.

import { matchComponentName, type MatchCandidate } from "@/lib/facturacion/domain/recipes"

export type ItemDeCatalogo = MatchCandidate & {
  price_cents: number
  tax_rate: number
}

export type RenglonSugerido = {
  /** El texto tal como estaba en el plan. Es lo que el vet reconoce. */
  descripcion: string
  /** El ítem del catálogo con el que calzó, o `null` si no calzó con ninguno. */
  catalogItemId: string | null
  unitPriceCents: number
  taxRate: number
}

/**
 * Las líneas del plan que parecen algo que se cobra.
 *
 * EL PLAN ES TEXTO LIBRE escrito por un veterinario (o redactado por Athos y aprobado por él), así
 * que no hay estructura garantizada. Lo que sí hay es una forma repetida: una cosa por línea, casi
 * siempre con viñeta o número.
 *
 * SE DESCARTA LO QUE CLARAMENTE NO SE COBRA. Un plan trae indicaciones ("reposo", "control en 7
 * días", "dieta blanda") mezcladas con lo que sí se factura. Proponer "reposo" como renglón hace
 * que el vet tenga que borrar más de lo que agrega — y una herramienta que da más trabajo que el
 * que ahorra se deja de usar.
 */
export function renglonesDelPlan(plan: string | null | undefined): string[] {
  return (plan ?? "")
    .split("\n")
    .map((l) =>
      l
        // Viñetas y numeración: "- ", "• ", "1. ", "2) "
        .replace(/^\s*(?:[-*•·—]|\d+[.)])\s*/, "")
        .trim(),
    )
    .filter((l) => l.length >= 3 && l.length <= 120)
    .filter((l) => !esIndicacion(l))
}

/**
 * Frases que son INSTRUCCIÓN y no algo que se cobre.
 *
 * La lista es corta a propósito: sólo lo inequívoco. Ante la duda el renglón se propone, porque
 * borrar una línea de más cuesta un clic y **olvidar cobrar algo cuesta plata** — y esa asimetría
 * es la que decide de qué lado errar.
 */
const INDICACIONES = [
  "reposo",
  "control en",
  "control a los",
  "volver en",
  "revisar en",
  "dieta blanda",
  "abundante agua",
  "no bañar",
  "observar",
  "vigilar",
  "seguimiento",
  "recomendaciones",
  "signos de alarma",
]

function esIndicacion(linea: string): boolean {
  const n = linea.toLowerCase()
  return INDICACIONES.some((i) => n.startsWith(i))
}

/**
 * Los renglones sugeridos para el carrito.
 *
 * Cada línea del plan se busca en el catálogo. Si calza, viaja con su precio y su IVA; si no,
 * viaja igual como línea libre en cero. **Nunca se descarta una línea por no encontrarla** — el
 * vet tiene que ver todo lo que se recetó, decidido por él y no por un umbral de similitud.
 */
export function sugerirRenglones(
  plan: string | null | undefined,
  catalogo: ItemDeCatalogo[],
): RenglonSugerido[] {
  const porId = new Map(catalogo.map((c) => [c.id, c]))
  return renglonesDelPlan(plan).map((descripcion) => {
    const m = matchComponentName(descripcion, catalogo)
    const item = m ? porId.get(m.id) : undefined
    return {
      descripcion,
      catalogItemId: item?.id ?? null,
      unitPriceCents: item?.price_cents ?? 0,
      taxRate: item?.tax_rate ?? 0,
    }
  })
}

/**
 * ¿Hay algo que valga la pena ofrecer?
 *
 * Sin renglones no se muestra el aviso de "armá la factura con lo recetado": abrir un carrito vacío
 * es exactamente lo que ya se podía hacer, y ofrecerlo como si fuera una ayuda es ruido.
 */
export function hayAlgoQueCobrar(plan: string | null | undefined): boolean {
  return renglonesDelPlan(plan).length > 0
}
