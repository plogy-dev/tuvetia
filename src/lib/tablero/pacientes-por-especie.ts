// Cuántos pacientes hay de cada especie — el dato de la segunda dona del tablero.
//
// ── DE DÓNDE SALE ─────────────────────────────────────────────────────────────────────────────
//
// David, 26-ago: «vuelve al de OkVet, quiero ver pie charts, más dinámico». OkVet pinta dos donas
// («Totales por servicio» y «Totales por especialidad»); nosotros ya teníamos la de ventas, y ésta
// es la otra mitad con el dato que una veterinaria sí tiene y una clínica humana no: de qué son
// los pacientes. No se inventa ninguna métrica — `patients.species` está poblada desde el alta.
//
// ── LA NORMALIZACIÓN NO ES COSMÉTICA ──────────────────────────────────────────────────────────
//
// Medido contra el principal (26-ago): conviven «Perro» (55) y «perro» (2). El campo es texto
// libre y se teclea a mano, así que agrupar por el valor crudo pintaría DOS gajos para la misma
// especie — y con dos colores distintos, que es la forma más rápida de que una dona mienta.
// Se compara sin tildes y en minúscula, y se acepta el singular y el plural: «gato» y «gatos» son
// la misma cosa para quien mira el tablero.
//
// ── EL COLOR VA CON LA ESPECIE, NO CON EL PUESTO ──────────────────────────────────────────────
//
// Misma regla que `ventas-por-tipo.ts`: los perros son menta este mes y el que viene, aunque los
// gatos los pasen. Un color que sigue al ranking hace que la dona haya que releerla cada vez.
//
// PURO Y SIN RED, como el resto de `lib/tablero/`: los tests corren en `environment: "node"`.

export type EspeciePaciente = {
  /** La clave normalizada: `perro`, `gato`, … o `otras`. */
  especie: string
  etiqueta: string
  total: number
  /** `var(--chart-N)` — fijo por especie, ver arriba. */
  color: string
}

/** Sin tildes, sin espacios de sobra y en minúscula. Es como se compara todo acá. */
function normalizar(valor: string): string {
  return valor
    .normalize("NFD")
    // Los diacríticos que NFD dejó sueltos. En escape explícito y no pegados en el literal: el
    // rango tecleado a mano es invisible en un diff y se rompe en el primer copiar y pegar.
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
}

/**
 * Las especies que tienen color propio, en el orden en que se pintan.
 *
 * `alias` recoge las formas en que la misma especie llega tecleada. Lo que no está en ninguna lista
 * cae en «Otras» — con su color y su gajo, nunca descartado: un paciente que desaparece de la dona
 * es peor que uno rotulado genérico.
 */
const ESPECIES: ReadonlyArray<{
  especie: string
  etiqueta: string
  color: string
  alias: readonly string[]
}> = [
  { especie: "perro", etiqueta: "Perros", color: "var(--chart-1)", alias: ["perro", "perros", "canino", "caninos", "can"] },
  { especie: "gato", etiqueta: "Gatos", color: "var(--chart-3)", alias: ["gato", "gatos", "felino", "felinos"] },
  { especie: "conejo", etiqueta: "Conejos", color: "var(--chart-2)", alias: ["conejo", "conejos", "lagomorfo"] },
  { especie: "ave", etiqueta: "Aves", color: "var(--chart-5)", alias: ["ave", "aves", "pajaro", "pajaros", "loro", "loros"] },
]

const OTRAS = { especie: "otras", etiqueta: "Otras especies", color: "var(--chart-4)" } as const

/** A qué grupo pertenece un `species` crudo. */
function grupoDe(species: string | null): string {
  if (!species) return OTRAS.especie
  const n = normalizar(species)
  if (!n) return OTRAS.especie
  return ESPECIES.find((e) => e.alias.includes(n))?.especie ?? OTRAS.especie
}

/**
 * Agrupa los pacientes por especie. Devuelve SÓLO los grupos con al menos uno —una dona con gajos
 * de cero es ruido—, en el orden fijo de `ESPECIES` con «Otras» al final.
 */
export function pacientesPorEspecie(
  pacientes: ReadonlyArray<{ species: string | null }>,
): EspeciePaciente[] {
  const cuenta = new Map<string, number>()
  for (const p of pacientes) {
    const g = grupoDe(p.species)
    cuenta.set(g, (cuenta.get(g) ?? 0) + 1)
  }
  const salida: EspeciePaciente[] = ESPECIES.filter((e) => (cuenta.get(e.especie) ?? 0) > 0).map(
    (e) => ({ especie: e.especie, etiqueta: e.etiqueta, total: cuenta.get(e.especie)!, color: e.color }),
  )
  const otras = cuenta.get(OTRAS.especie) ?? 0
  if (otras > 0) {
    salida.push({ especie: OTRAS.especie, etiqueta: OTRAS.etiqueta, total: otras, color: OTRAS.color })
  }
  return salida
}
